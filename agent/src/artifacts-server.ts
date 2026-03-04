import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { readFile, stat, readdir } from "node:fs/promises";
import { resolve, extname, relative, normalize, join } from "node:path";
import { watch } from "chokidar";
import { WebSocketServer, type WebSocket } from "ws";

// ---------------------------------------------------------------------------
// MIME types
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
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
};

// ---------------------------------------------------------------------------
// Live reload script injected into HTML responses
// ---------------------------------------------------------------------------

function liveReloadScript(wsOrigin: string): string {
  return `<script>
(function(){var ws=new WebSocket(${JSON.stringify(wsOrigin + "/__live")});ws.onmessage=function(){location.reload()};ws.onclose=function(){setTimeout(function(){location.reload()},1000)}})();
</script>`;
}

// ---------------------------------------------------------------------------
// ArtifactsServer
// ---------------------------------------------------------------------------

export interface ArtifactFileEntry {
  path: string;
  name: string;
  size: number;
  mtime: string;
  isDirectory: boolean;
}

export interface ArtifactsServerConfig {
  port: number;
  host: string;
  rootDir: string;
  onChange?: (event: string, path: string) => void;
}

export class ArtifactsServer {
  private server: ReturnType<typeof createServer> | null = null;
  private liveReloadWss: WebSocketServer | null = null;
  private watcher: ReturnType<typeof watch> | null = null;
  private wsClients = new Set<WebSocket>();
  private wsOrigin: string;

  constructor(private config: ArtifactsServerConfig) {
    this.wsOrigin = `ws://${config.host}:${config.port}`;
  }

  /** Standalone mode: creates its own HTTP server + live reload WSS. */
  async start(): Promise<void> {
    const { port, host, rootDir } = this.config;

    // HTTP server
    this.server = createServer((req, res) => this.handleRequest(req, res));

    // WebSocket server on the same HTTP server
    this.liveReloadWss = new WebSocketServer({ server: this.server, path: "/__live" });
    this.liveReloadWss.on("connection", (ws) => {
      this.wsClients.add(ws);
      ws.on("close", () => this.wsClients.delete(ws));
    });

    this.startWatcher(rootDir);

    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        console.log(`Artifacts server at http://${host}:${port}/ (root: ${rootDir})`);
        resolve();
      });
      this.server!.on("error", reject);
    });
  }

  /**
   * Attached mode: creates a noServer live reload WSS and starts the file
   * watcher, but does NOT create its own HTTP server. The caller (AppChannel)
   * owns the HTTP server and delegates requests/upgrades here.
   */
  startAttached(wsOrigin: string): void {
    this.wsOrigin = wsOrigin;
    this.liveReloadWss = new WebSocketServer({ noServer: true });
    this.liveReloadWss.on("connection", (ws) => {
      this.wsClients.add(ws);
      ws.on("close", () => this.wsClients.delete(ws));
    });
    this.startWatcher(this.config.rootDir);
    console.log(`Artifacts attached (root: ${this.config.rootDir})`);
  }

  /** Handle a WebSocket upgrade for the /__live path. */
  handleLiveReloadUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.liveReloadWss) return;
    this.liveReloadWss.handleUpgrade(req, socket, head, (ws) => {
      this.liveReloadWss!.emit("connection", ws, req);
    });
  }

  async stop(): Promise<void> {
    this.watcher?.close();
    this.watcher = null;

    for (const ws of this.wsClients) ws.close();
    this.wsClients.clear();

    if (this.liveReloadWss) {
      this.liveReloadWss.close();
      this.liveReloadWss = null;
    }

    return new Promise((resolveP) => {
      if (!this.server) return resolveP();
      this.server.close(() => {
        this.server = null;
        resolveP();
      });
    });
  }

  private startWatcher(rootDir: string): void {
    this.watcher = watch(rootDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    this.watcher.on("all", (event, changedPath) => {
      const rel = relative(rootDir, changedPath as string);
      const msg = JSON.stringify({ type: "reload", path: rel });
      for (const ws of this.wsClients) {
        if (ws.readyState === ws.OPEN) ws.send(msg);
      }
      this.config.onChange?.(event, rel);
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP request handler
  // ---------------------------------------------------------------------------

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);

    // /__files directory listing endpoint
    if (pathname === "/__files") {
      try {
        const entries = await this.walkDir(this.config.rootDir, "");
        entries.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
        const body = JSON.stringify(entries);
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store, no-cache",
        });
        res.end(body);
      } catch {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        });
        res.end("[]");
      }
      return;
    }

    // Resolve to filesystem path and guard against path traversal
    const filePath = resolve(this.config.rootDir, "." + normalize("/" + pathname));
    if (!filePath.startsWith(this.config.rootDir)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    try {
      let st = await stat(filePath);

      // Serve index.html for directories
      let servePath = filePath;
      if (st.isDirectory()) {
        servePath = resolve(filePath, "index.html");
        st = await stat(servePath);
      }

      const ext = extname(servePath).toLowerCase();
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      let body = await readFile(servePath);

      // Inject live reload script into HTML
      if (ext === ".html") {
        let html = body.toString("utf-8");
        const script = liveReloadScript(this.wsOrigin);
        if (html.includes("</body>")) {
          html = html.replace("</body>", script + "</body>");
        } else {
          html += script;
        }
        body = Buffer.from(html, "utf-8");
      }

      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": body.length,
        "Cache-Control": "no-store, no-cache",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  }

  // ---------------------------------------------------------------------------
  // Recursive directory walker for /__files
  // ---------------------------------------------------------------------------

  private async walkDir(rootDir: string, prefix: string): Promise<ArtifactFileEntry[]> {
    const entries: ArtifactFileEntry[] = [];
    const dirPath = prefix ? join(rootDir, prefix) : rootDir;

    let items: string[];
    try {
      items = await readdir(dirPath);
    } catch {
      return entries;
    }

    for (const name of items) {
      if (name.startsWith(".")) continue;
      const fullPath = join(dirPath, name);
      const relPath = prefix ? `${prefix}/${name}` : name;
      try {
        const st = await stat(fullPath);
        entries.push({
          path: relPath,
          name,
          size: st.size,
          mtime: st.mtime.toISOString(),
          isDirectory: st.isDirectory(),
        });
        if (st.isDirectory()) {
          const children = await this.walkDir(rootDir, relPath);
          entries.push(...children);
        }
      } catch {
        // skip inaccessible files
      }
    }

    return entries;
  }
}
