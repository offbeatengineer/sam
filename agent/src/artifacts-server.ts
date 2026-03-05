import { readFile, stat, readdir } from "node:fs/promises";
import { resolve, extname, relative, normalize, join } from "node:path";
import { watch } from "chokidar";
import type { ServerWebSocket } from "bun";

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
  private server: ReturnType<typeof Bun.serve> | null = null;
  private watcher: ReturnType<typeof watch> | null = null;
  private liveReloadClients = new Set<ServerWebSocket<any>>();
  private wsOrigin: string;

  constructor(private config: ArtifactsServerConfig) {
    this.wsOrigin = `ws://${config.host}:${config.port}`;
  }

  /** Standalone mode: creates its own Bun.serve() with live reload WebSocket. */
  async start(): Promise<void> {
    const { port, host, rootDir } = this.config;
    const self = this;

    this.server = Bun.serve({
      port,
      hostname: host,
      fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === "/__live") {
          if (server.upgrade(req, { data: { type: "live-reload" as const } })) {
            return undefined;
          }
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return self.handleRequest(req);
      },
      websocket: {
        open(ws) {
          self.liveReloadClients.add(ws);
        },
        message() {},
        close(ws) {
          self.liveReloadClients.delete(ws);
        },
      },
    });

    this.startWatcher(rootDir);
    console.log(`Artifacts server at http://${host}:${port}/ (root: ${rootDir})`);
  }

  /**
   * Attached mode: no own server. The caller (AppChannel) owns the server
   * and delegates requests here. Live-reload WebSocket clients are managed
   * by the caller's websocket handler via addLiveReloadClient/removeLiveReloadClient.
   */
  startAttached(wsOrigin: string): void {
    this.wsOrigin = wsOrigin;
    this.startWatcher(this.config.rootDir);
    console.log(`Artifacts attached (root: ${this.config.rootDir})`);
  }

  /** Called by AppChannel when a /__live WebSocket connects. */
  addLiveReloadClient(ws: ServerWebSocket<any>): void {
    this.liveReloadClients.add(ws);
  }

  /** Called by AppChannel when a /__live WebSocket disconnects. */
  removeLiveReloadClient(ws: ServerWebSocket<any>): void {
    this.liveReloadClients.delete(ws);
  }

  async stop(): Promise<void> {
    this.watcher?.close();
    this.watcher = null;

    for (const ws of this.liveReloadClients) {
      ws.close();
    }
    this.liveReloadClients.clear();

    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  private startWatcher(rootDir: string): void {
    this.watcher = watch(rootDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    this.watcher.on("all", (event, changedPath) => {
      const rel = relative(rootDir, changedPath as string);
      const msg = JSON.stringify({ type: "reload", path: rel });
      for (const ws of this.liveReloadClients) {
        ws.send(msg);
      }
      this.config.onChange?.(event, rel);
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP request handler — returns a Response object
  // ---------------------------------------------------------------------------

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    // /__files directory listing endpoint
    if (pathname === "/__files") {
      try {
        const entries = await this.walkDir(this.config.rootDir, "");
        entries.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
        return new Response(JSON.stringify(entries), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store, no-cache",
          },
        });
      } catch {
        return new Response("[]", {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // Resolve to filesystem path and guard against path traversal
    const filePath = resolve(this.config.rootDir, "." + normalize("/" + pathname));
    if (!filePath.startsWith(this.config.rootDir)) {
      return new Response("Forbidden", { status: 403 });
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

      // Inject live reload script into HTML
      if (ext === ".html") {
        let html = await Bun.file(servePath).text();
        const script = liveReloadScript(this.wsOrigin);
        if (html.includes("</body>")) {
          html = html.replace("</body>", script + "</body>");
        } else {
          html += script;
        }
        return new Response(html, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "no-store, no-cache",
          },
        });
      }

      return new Response(Bun.file(servePath), {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store, no-cache",
        },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
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
