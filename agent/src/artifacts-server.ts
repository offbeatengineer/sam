import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, relative, normalize } from "node:path";
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

function liveReloadScript(wsPort: number, wsHost: string): string {
  return `<script>
(function(){var ws=new WebSocket("ws://"+${JSON.stringify(wsHost)}+":"+${JSON.stringify(wsPort)}+"/__live");ws.onmessage=function(){location.reload()};ws.onclose=function(){setTimeout(function(){location.reload()},1000)}})();
</script>`;
}

// ---------------------------------------------------------------------------
// ArtifactsServer
// ---------------------------------------------------------------------------

export interface ArtifactsServerConfig {
  port: number;
  host: string;
  rootDir: string;
}

export class ArtifactsServer {
  private server: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private watcher: ReturnType<typeof watch> | null = null;
  private wsClients = new Set<WebSocket>();

  constructor(private config: ArtifactsServerConfig) {}

  async start(): Promise<void> {
    const { port, host, rootDir } = this.config;

    // HTTP server
    this.server = createServer((req, res) => this.handleRequest(req, res));

    // WebSocket server on the same HTTP server
    this.wss = new WebSocketServer({ server: this.server, path: "/__live" });
    this.wss.on("connection", (ws) => {
      this.wsClients.add(ws);
      ws.on("close", () => this.wsClients.delete(ws));
    });

    // File watcher
    this.watcher = watch(rootDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    this.watcher.on("all", (_event, changedPath) => {
      const rel = relative(rootDir, changedPath as string);
      const msg = JSON.stringify({ type: "reload", path: rel });
      for (const ws of this.wsClients) {
        if (ws.readyState === ws.OPEN) ws.send(msg);
      }
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        console.log(`Artifacts server at http://${host}:${port}/ (root: ${rootDir})`);
        resolve();
      });
      this.server!.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    this.watcher?.close();
    this.watcher = null;

    for (const ws of this.wsClients) ws.close();
    this.wsClients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    return new Promise((resolveP) => {
      if (!this.server) return resolveP();
      this.server.close(() => {
        this.server = null;
        resolveP();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // HTTP request handler
  // ---------------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);

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
        const script = liveReloadScript(this.config.port, this.config.host);
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
}
