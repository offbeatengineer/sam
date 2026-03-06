import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, extname, normalize, relative } from "node:path";
import { readFile, stat, readdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KitManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  enabled: boolean;
}

export interface KitInfoDTO {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  enabled: boolean;
}

export interface KitContext {
  kitId: string;
  db: Database;
  config: KitManifest;
  kitsDir: string;
}

export interface KitsServerConfig {
  dir: string;
}

// ---------------------------------------------------------------------------
// MIME types for serving kit frontend files
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

// ---------------------------------------------------------------------------
// AGENTS.md — read from the kit-template directory
// ---------------------------------------------------------------------------

const KIT_TEMPLATE_DIR = resolve(import.meta.dir, "kit-template");
const AGENTS_MD_PATH = resolve(KIT_TEMPLATE_DIR, "AGENTS.md");
const KIT_LIB_PATH = resolve(KIT_TEMPLATE_DIR, "src", "lib", "kit.ts");

// ---------------------------------------------------------------------------
// KitsServer
// ---------------------------------------------------------------------------

export class KitsServer extends EventEmitter {
  private db: Database;
  private routers = new Map<string, Hono>();
  private manifests = new Map<string, KitManifest>();
  private kitsDir: string;

  constructor(config: KitsServerConfig) {
    super();
    this.kitsDir = config.dir;
    mkdirSync(this.kitsDir, { recursive: true });

    // Open or create the shared SQLite database
    const dbPath = resolve(this.kitsDir, "kits.db");
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  /** Scan kits directory and load all enabled kits. */
  async init(): Promise<void> {
    if (!existsSync(this.kitsDir)) return;

    // Scaffold shared UI library if not present
    this.ensureSharedLibrary();

    const entries = readdirSync(this.kitsDir);
    for (const entry of entries) {
      const kitDir = resolve(this.kitsDir, entry);
      const manifestPath = resolve(kitDir, "kit.json");
      if (!existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as KitManifest;
        this.manifests.set(manifest.id, manifest);
        if (manifest.enabled !== false) {
          await this.loadKit(manifest.id);
        }
      } catch (err) {
        console.warn(`[kits] Failed to load kit from ${entry}:`, err);
      }
    }

    const loaded = [...this.routers.keys()];
    if (loaded.length > 0) {
      console.log(`[kits] Loaded ${loaded.length} kit(s): ${loaded.join(", ")}`);
    }
  }

  /** Load a kit's backend module and mount its router. */
  async loadKit(kitId: string): Promise<void> {
    const kitDir = resolve(this.kitsDir, kitId);
    const serverEntry = resolve(kitDir, "server", "index.ts");

    if (!existsSync(serverEntry)) {
      console.warn(`[kits] Kit "${kitId}" has no server/index.ts — skipping backend`);
      return;
    }

    // Install dependencies if needed (both server and client deps live in kit root package.json)
    if (existsSync(resolve(kitDir, "package.json")) && !existsSync(resolve(kitDir, "node_modules"))) {
      console.log(`[kits] Installing dependencies for kit "${kitId}"...`);
      const proc = Bun.spawnSync(["bun", "install"], { cwd: kitDir });
      if (proc.exitCode !== 0) {
        console.error(`[kits] Failed to install deps for kit "${kitId}":`, proc.stderr.toString());
        return;
      }
    }

    // Read manifest if not cached
    if (!this.manifests.has(kitId)) {
      const manifestPath = resolve(kitDir, "kit.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as KitManifest;
      this.manifests.set(kitId, manifest);
    }

    const ctx: KitContext = {
      kitId,
      db: this.db,
      config: this.manifests.get(kitId)!,
      kitsDir: this.kitsDir,
    };

    try {
      const mod = await import(serverEntry);
      const createRouter = mod.default ?? mod;
      const router = createRouter(ctx);
      this.routers.set(kitId, router);
      this.emit("kitsChanged", "loaded", kitId);
    } catch (err) {
      console.error(`[kits] Failed to load backend for kit "${kitId}":`, err);
    }
  }

  /** Unload a kit's backend router. */
  async unloadKit(kitId: string): Promise<void> {
    this.routers.delete(kitId);
    this.emit("kitsChanged", "unloaded", kitId);
  }

  /** Reload a kit — unload then load again, busting the module cache. */
  async reloadKit(kitId: string): Promise<void> {
    await this.unloadKit(kitId);

    // Clear Bun's module cache for the kit's server files
    const kitDir = resolve(this.kitsDir, kitId, "server");
    const registry = require.cache ?? (Loader as any)?.registry;
    if (registry && typeof registry === "object") {
      for (const key of Object.keys(registry)) {
        if (key.includes(kitDir)) {
          delete registry[key];
        }
      }
    }

    // Re-read manifest in case it changed
    const manifestPath = resolve(this.kitsDir, kitId, "kit.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as KitManifest;
      this.manifests.set(kitId, manifest);
    }

    await this.loadKit(kitId);
  }

  /** Build a kit's frontend using Vite. */
  async buildKit(kitId: string): Promise<void> {
    const kitDir = resolve(this.kitsDir, kitId);
    if (!existsSync(resolve(kitDir, "package.json"))) return;

    // Install deps if node_modules doesn't exist
    if (!existsSync(resolve(kitDir, "node_modules"))) {
      console.log(`[kits] Installing dependencies for kit "${kitId}"...`);
      const installProc = Bun.spawnSync(["bun", "install"], { cwd: kitDir });
      if (installProc.exitCode !== 0) {
        console.error(`[kits] Failed to install deps for kit "${kitId}":`, installProc.stderr.toString());
        return;
      }
    }

    // Sync shared kit library before building
    this.syncKitLib(kitDir);

    console.log(`[kits] Building frontend for kit "${kitId}"...`);
    const buildProc = Bun.spawnSync(["bunx", "vite", "build"], { cwd: kitDir });
    if (buildProc.exitCode !== 0) {
      console.error(`[kits] Failed to build kit "${kitId}":`, buildProc.stderr.toString());
      return;
    }
    console.log(`[kits] Built kit "${kitId}" successfully.`);
    this.emit("kitsChanged", "built", kitId);
  }

  /** Get all kit manifests. */
  getKits(): KitInfoDTO[] {
    const kits: KitInfoDTO[] = [];
    // Re-scan directory for fresh data
    if (!existsSync(this.kitsDir)) return kits;

    const entries = readdirSync(this.kitsDir);
    for (const entry of entries) {
      const manifestPath = resolve(this.kitsDir, entry, "kit.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as KitManifest;
        kits.push({
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          icon: manifest.icon,
          version: manifest.version,
          enabled: manifest.enabled !== false,
        });
      } catch {
        // skip malformed manifests
      }
    }
    return kits;
  }

  // ---------------------------------------------------------------------------
  // HTTP request handler
  // ---------------------------------------------------------------------------

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // CORS headers for cross-origin requests (Tauri dev mode)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // GET /kits — list all kits
    if (pathname === "/kits" || pathname === "/kits/") {
      return Response.json(this.getKits(), { headers: corsHeaders });
    }

    // Extract kit ID from path: /kits/<kitId>/...
    const match = pathname.match(/^\/kits\/([a-zA-Z0-9_-]+)(\/.*)?$/);
    if (!match) {
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    }

    const kitId = match[1];
    const subPath = match[2] ?? "/";

    // API routes: /kits/<kitId>/api/...
    if (subPath.startsWith("/api")) {
      const router = this.routers.get(kitId);
      if (!router) {
        return Response.json({ error: `Kit "${kitId}" not loaded or has no backend` }, { status: 404, headers: corsHeaders });
      }

      // Rewrite the request URL to strip the /kits/<kitId>/api prefix
      // so the kit's Hono router sees clean paths like /quote, /todos
      const routePath = subPath.replace(/^\/api/, "") || "/";
      const rewrittenUrl = new URL(routePath, url.origin);
      rewrittenUrl.search = url.search;
      const rewrittenReq = new Request(rewrittenUrl.toString(), {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });

      return router.fetch(rewrittenReq);
    }

    // Static files: /kits/<kitId>/... — serve from dist/ directory
    return this.serveKitStatic(kitId, subPath);
  }

  // ---------------------------------------------------------------------------
  // Shared UI library scaffolding
  // ---------------------------------------------------------------------------

  private ensureSharedLibrary(): void {
    // Always write AGENTS.md so it stays in sync with the codebase
    writeFileSync(resolve(this.kitsDir, "AGENTS.md"), readFileSync(AGENTS_MD_PATH, "utf-8"));
  }

  /** Copy the latest kit bridge library into a kit's source tree. */
  private syncKitLib(kitDir: string): void {
    const dest = resolve(kitDir, "src", "lib", "kit.ts");
    mkdirSync(resolve(kitDir, "src", "lib"), { recursive: true });
    writeFileSync(dest, readFileSync(KIT_LIB_PATH, "utf-8"));
  }

  // ---------------------------------------------------------------------------
  // Static file serving for kit frontends
  // ---------------------------------------------------------------------------

  private async serveKitStatic(kitId: string, subPath: string): Promise<Response> {
    const distDir = resolve(this.kitsDir, kitId, "dist");
    if (!existsSync(distDir)) {
      return new Response("Kit frontend not built", { status: 404 });
    }

    // Resolve path and guard against traversal
    let filePath = resolve(distDir, "." + normalize("/" + decodeURIComponent(subPath)));
    if (!filePath.startsWith(distDir)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      let st = await stat(filePath);

      // Serve index.html for directories
      if (st.isDirectory()) {
        filePath = resolve(filePath, "index.html");
        st = await stat(filePath);
      }

      const ext = extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

      return new Response(Bun.file(filePath), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store, no-cache",
        },
      });
    } catch {
      // SPA fallback — serve index.html for any unknown path
      const indexPath = resolve(distDir, "index.html");
      try {
        return new Response(Bun.file(indexPath), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store, no-cache",
          },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }
  }
}
