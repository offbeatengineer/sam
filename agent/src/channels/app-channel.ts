import type { ServerWebSocket } from "bun";
import type { SessionRegistry } from "../session-registry.js";
import type { AppRequest, AppResponse, ChatAttachment, SessionInfoDTO, SkillInfoDTO } from "../protocol.js";
import type { SessionKey } from "../types.js";
import { MemoryStore } from "../memory/store.js";
import type { MemoryConfig } from "../memory/types.js";
import type { ArtifactsServer } from "../artifacts-server.js";
import type { KitsServer } from "../kits-server.js";
import type { Transcriber } from "../transcriber.js";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { readdirSync, readFileSync, writeFileSync, unlinkSync, statSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { resolve, basename, dirname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

interface AppChannelOptions {
  port: number;
  host?: string;
  apiKey?: string;
  registry: SessionRegistry;
  memoryConfig?: MemoryConfig;
  sessionsDir: string;
  skillsDir: string;
  artifactsServer?: ArtifactsServer;
  kitsServer?: KitsServer;
  transcriber?: Transcriber;
}

// Rate limiting constants
const MAX_CONNECTIONS_PER_MINUTE = 10;
const MAX_MESSAGES_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Upload constants
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_UPLOAD_MIMES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic",
  "audio/aac", "audio/m4a", "audio/mp4", "audio/mpeg", "audio/wav",
]);
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
  "audio/aac": "aac", "audio/m4a": "m4a", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav",
};

// Input validation constants
const MAX_CONVERSATION_ID_LENGTH = 100;
const MAX_REQUEST_ID_LENGTH = 100;
const MAX_TEXT_LENGTH = 100 * 1024; // 100KB
const CONVERSATION_ID_PATTERN = /^[a-zA-Z0-9-]+$/;

/** WebSocket data types for discriminated routing */
type WsData =
  | { type: "app" }
  | { type: "live-reload" };

type AppWebSocket = ServerWebSocket<WsData>;

export class AppChannel {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private clients = new Set<AppWebSocket>();
  /** Maps conversationId → the WebSocket client that owns it */
  private conversationOwners = new Map<string, AppWebSocket>();
  /** Maps conversationId → current requestId */
  private activeRequests = new Map<string, string>();
  /** Tracks which sessions already have subscriptions */
  private subscriptions = new Set<string>();
  /** Connection rate limiting: IP → timestamps */
  private connectionAttempts = new Map<string, number[]>();
  /** Message rate limiting per WebSocket */
  private messageCounters = new WeakMap<AppWebSocket, { count: number; resetAt: number }>();

  constructor(private options: AppChannelOptions) {}

  async start(): Promise<void> {
    const { port, host, apiKey, artifactsServer, kitsServer } = this.options;
    const listenHost = host ?? "127.0.0.1";
    const self = this;

    this.server = Bun.serve<WsData>({
      port,
      hostname: listenHost,

      async fetch(req, server) {
        const url = new URL(req.url);

        // --- WebSocket upgrades ---

        // Live-reload WebSocket for artifacts
        if (url.pathname === "/__live" && artifactsServer) {
          if (server.upgrade(req, { data: { type: "live-reload" as const } })) {
            return undefined;
          }
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // App WebSocket upgrade (any other WebSocket request)
        if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          // Auth check
          if (apiKey && !self.verifyApiKey(req, apiKey)) {
            return new Response("Unauthorized", { status: 401 });
          }

          // Rate limit check
          const ip = self.getClientIp(req, server);
          if (!self.checkConnectionRateLimit(ip)) {
            return new Response("Too Many Requests", { status: 429 });
          }

          if (server.upgrade(req, { data: { type: "app" as const } })) {
            return undefined;
          }
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        // --- HTTP routes ---

        if (req.method === "POST" && url.pathname === "/upload") {
          try {
            return await self.handleUpload(req);
          } catch (err) {
            console.error("Upload error:", err);
            return Response.json({ error: "Internal server error" }, { status: 500 });
          }
        }

        if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
          return self.handleServeUpload(req, url);
        }

        // Kits routes
        if (url.pathname.startsWith("/kits") && kitsServer) {
          return kitsServer.handleRequest(req);
        }

        if (artifactsServer) {
          return artifactsServer.handleRequest(req);
        }

        return new Response("WebSocket required", { status: 426 });
      },

      websocket: {
        open(ws) {
          if (ws.data.type === "live-reload") {
            artifactsServer?.addLiveReloadClient(ws);
            return;
          }

          // App WebSocket
          self.clients.add(ws);
          console.log(`App client connected (${self.clients.size} total)`);
        },

        message(ws, msg) {
          if (ws.data.type === "live-reload") return;

          // Message rate limiting
          if (!self.checkMessageRateLimit(ws)) {
            self.sendTo(ws, { type: "error", error: "Rate limit exceeded: too many messages" });
            return;
          }

          try {
            const request = JSON.parse(typeof msg === "string" ? msg : new TextDecoder().decode(msg)) as AppRequest;
            const validationError = self.validateRequest(request);
            if (validationError) {
              self.sendTo(ws, { type: "error", error: validationError });
              return;
            }
            self.handleRequest(ws, request);
          } catch (err) {
            self.sendTo(ws, { type: "error", error: `Invalid message: ${err}` });
          }
        },

        close(ws) {
          if (ws.data.type === "live-reload") {
            artifactsServer?.removeLiveReloadClient(ws);
            return;
          }

          self.clients.delete(ws);
          // Clean up conversation ownership for this client
          for (const [convId, owner] of self.conversationOwners) {
            if (owner === ws) {
              self.conversationOwners.delete(convId);
              self.activeRequests.delete(convId);
            }
          }
          console.log(`App client disconnected (${self.clients.size} remaining)`);
        },
      },
    });

    // Listen for kit changes from the kits server (e.g. when agent tool creates/builds a kit)
    if (kitsServer) {
      kitsServer.on("kitsChanged", (event: string, kitId: string) => {
        this.broadcastKitsChanged(event, kitId);
      });
    }

    console.log(`App channel listening on ${listenHost}:${port}`);
  }

  async stop(): Promise<void> {
    for (const ws of this.clients) {
      ws.close();
    }
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Authentication & rate limiting
  // ---------------------------------------------------------------------------

  private verifyApiKey(req: Request, expectedKey: string): boolean {
    // Check Authorization: Bearer <key> header
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const [scheme, token] = authHeader.split(" ");
      if (scheme?.toLowerCase() === "bearer" && token === expectedKey) return true;
    }
    // Check ?apiKey= query param
    const url = new URL(req.url);
    const queryKey = url.searchParams.get("apiKey");
    if (queryKey === expectedKey) return true;

    return false;
  }

  private getClientIp(req: Request, server: { requestIP(req: Request): { address: string } | null }): string {
    // Support Cloudflare Tunnel forwarded IP
    const forwarded = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
    if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
    return server.requestIP(req)?.address ?? "unknown";
  }

  private checkConnectionRateLimit(ip: string): boolean {
    const now = Date.now();
    let attempts = this.connectionAttempts.get(ip);
    if (!attempts) {
      attempts = [];
      this.connectionAttempts.set(ip, attempts);
    }
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    while (attempts.length > 0 && attempts[0] < cutoff) attempts.shift();
    if (attempts.length >= MAX_CONNECTIONS_PER_MINUTE) return false;
    attempts.push(now);
    return true;
  }

  private checkMessageRateLimit(ws: AppWebSocket): boolean {
    const now = Date.now();
    let counter = this.messageCounters.get(ws);
    if (!counter || now >= counter.resetAt) {
      counter = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      this.messageCounters.set(ws, counter);
    }
    counter.count++;
    return counter.count <= MAX_MESSAGES_PER_MINUTE;
  }

  // ---------------------------------------------------------------------------
  // Input validation
  // ---------------------------------------------------------------------------

  private validateRequest(request: AppRequest): string | null {
    if ("conversationId" in request && request.conversationId != null) {
      const cid = request.conversationId;
      if (typeof cid !== "string" || cid.length > MAX_CONVERSATION_ID_LENGTH) {
        return "conversationId must be a string of max 100 characters";
      }
      if (!CONVERSATION_ID_PATTERN.test(cid)) {
        return "conversationId must contain only alphanumeric characters and hyphens";
      }
    }

    if ("requestId" in request && (request as any).requestId != null) {
      const rid = (request as any).requestId as string;
      if (typeof rid !== "string" || rid.length > MAX_REQUEST_ID_LENGTH) {
        return "requestId must be a string of max 100 characters";
      }
    }

    if (request.type === "chat") {
      if (typeof request.text !== "string" || request.text.length > MAX_TEXT_LENGTH) {
        return "text must be a string of max 100KB";
      }
    }

    if ("sessionPath" in request && (request as any).sessionPath != null) {
      const sp = (request as any).sessionPath as string;
      if (typeof sp !== "string" || sp.includes("..")) {
        return "sessionPath must not contain path traversal sequences";
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // File upload handling
  // ---------------------------------------------------------------------------

  private async handleUpload(req: Request): Promise<Response> {
    const { apiKey } = this.options;
    if (apiKey && !this.verifyApiKey(req, apiKey)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!ALLOWED_UPLOAD_MIMES.has(contentType)) {
      return Response.json(
        { error: `Unsupported content type: ${contentType}. Allowed: ${[...ALLOWED_UPLOAD_MIMES].join(", ")}` },
        { status: 400 },
      );
    }

    const body = await req.arrayBuffer();
    if (body.byteLength === 0) {
      return Response.json({ error: "Empty body" }, { status: 400 });
    }
    if (body.byteLength > MAX_UPLOAD_SIZE) {
      return Response.json(
        { error: `File too large. Max size: ${MAX_UPLOAD_SIZE / 1024 / 1024}MB` },
        { status: 413 },
      );
    }

    // Save to ~/.sam/uploads/YYYY-MM-DD/<uuid>.<ext>
    const now = new Date();
    const dateDir = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const uploadsDir = resolve(homedir(), ".sam", "uploads", dateDir);
    mkdirSync(uploadsDir, { recursive: true });

    const id = randomUUID();
    const ext = MIME_EXTENSIONS[contentType] ?? "bin";
    const filePath = join(uploadsDir, `${id}.${ext}`);
    await Bun.write(filePath, body);

    return Response.json({ id, path: filePath, mimeType: contentType });
  }

  // ---------------------------------------------------------------------------
  // Serve uploaded files via HTTP GET /uploads/*
  // ---------------------------------------------------------------------------

  private handleServeUpload(req: Request, url: URL): Response {
    if (this.options.apiKey) {
      const auth = req.headers.get("authorization");
      const qKey = url.searchParams.get("apiKey");
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : qKey;
      if (token !== this.options.apiKey) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const uploadsDir = join(homedir(), ".sam", "uploads");
    const relativePath = decodeURIComponent(url.pathname.slice("/uploads/".length));
    const filePath = resolve(uploadsDir, relativePath);

    // Path traversal protection
    if (!filePath.startsWith(uploadsDir)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!existsSync(filePath)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    // Determine MIME type from extension
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
      heic: "image/heic", aac: "audio/aac", m4a: "audio/m4a", mp3: "audio/mpeg", wav: "audio/wav",
    };
    const contentType = mimeMap[ext] ?? "application/octet-stream";

    return new Response(Bun.file(filePath), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Strip base64 image data from session entries for WebSocket transfer
  // ---------------------------------------------------------------------------

  private stripAttachmentData(entries: any[]): any[] {
    const uploadsDir = join(homedir(), ".sam", "uploads");
    const cacheDir = join(uploadsDir, "entry-cache");

    return entries.map((entry) => {
      // Transform custom audio_attachment entries: add URL from uploadPath
      if (entry?.type === "custom" && entry?.customType === "audio_attachment" && entry?.data?.uploadPath) {
        return { ...entry, data: { ...entry.data, url: `/uploads/${entry.data.uploadPath}` } };
      }

      if (entry?.message?.role !== "user" || !Array.isArray(entry.message.content)) {
        return entry;
      }

      let changed = false;
      const processedContent: any[] = [];

      for (let idx = 0; idx < entry.message.content.length; idx++) {
        const block = entry.message.content[idx];

        // Strip base64 from image blocks
        if (block.type === "image" && block.data) {
          changed = true;
          if (block.uploadPath) {
            const { data: _data, ...rest } = block;
            processedContent.push({ ...rest, url: `/uploads/${block.uploadPath}` });
          } else {
            // Legacy fallback: extract base64 to cache file
            const ext = MIME_EXTENSIONS[block.mimeType] || "jpg";
            const filename = `${entry.id}-${idx}.${ext}`;
            const cachePath = join(cacheDir, filename);
            if (!existsSync(cachePath)) {
              mkdirSync(cacheDir, { recursive: true });
              writeFileSync(cachePath, Buffer.from(block.data, "base64"));
            }
            const { data: _data, ...rest } = block;
            processedContent.push({ ...rest, url: `/uploads/entry-cache/${filename}` });
          }
          continue;
        }

        processedContent.push(block);
      }

      if (!changed) return entry;
      return { ...entry, message: { ...entry.message, content: processedContent } };
    });
  }

  // ---------------------------------------------------------------------------
  // Request handling
  // ---------------------------------------------------------------------------

  private async handleRequest(ws: AppWebSocket, request: AppRequest): Promise<void> {
    switch (request.type) {
      case "chat":
        return this.handleChat(ws, request);
      case "abort":
        return this.handleAbort(request.conversationId);
      case "close_session":
        return this.handleCloseSession(ws, request.conversationId);
      case "list_sessions":
        return this.handleListSessions(ws, request);
      case "get_session_entries":
        return this.handleGetSessionEntries(ws, request);
      case "rename_session":
        return this.handleRenameSession(ws, request);
      case "archive_session":
        return this.handleArchiveSession(ws, request);
      case "unarchive_session":
        return this.handleUnarchiveSession(ws, request);
      case "list_archived_sessions":
        return this.handleListArchivedSessions(ws, request);
      case "memory_list":
      case "memory_search":
      case "memory_save":
      case "memory_update":
      case "memory_delete":
        return this.handleMemoryRequest(ws, request);
      case "list_skills":
      case "get_skill":
      case "save_skill":
      case "delete_skill":
        return this.handleSkillRequest(ws, request);
      case "list_kits":
      case "enable_kit":
      case "disable_kit":
      case "reload_kit":
      case "delete_kit":
        return this.handleKitRequest(ws, request);
      default:
        this.sendTo(ws, { type: "error", error: `Unknown request type: ${(request as any).type}` });
    }
  }

  private async handleChat(
    ws: AppWebSocket,
    request: Extract<AppRequest, { type: "chat" }>,
  ): Promise<void> {
    const { conversationId, requestId, text, attachments } = request;
    const registry = this.options.registry;
    const sessionKey: SessionKey = { channelId: "app", conversationId };

    this.conversationOwners.set(conversationId, ws);
    this.activeRequests.set(conversationId, requestId);

    try {
      const isNew = !registry.has(sessionKey);
      const session = await registry.getOrCreate(sessionKey);

      if (isNew) {
        this.sendTo(ws, { type: "session_created", conversationId });
      }

      this.ensureSubscription(conversationId, session);

      this.sendTo(ws, { type: "turn_start", conversationId, requestId });

      // Process attachments if present
      let promptText = text;
      const uploadsDir = join(homedir(), ".sam", "uploads");
      const images: { type: "image"; data: string; mimeType: string; uploadPath?: string }[] = [];
      const audioMeta: { uploadPath: string; mimeType: string }[] = [];

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (!existsSync(att.path)) {
            console.warn(`Attachment file not found: ${att.path}`);
            continue;
          }
          const fileBuffer = readFileSync(att.path);

          if (att.type === "image") {
            const uploadPath = att.path.startsWith(uploadsDir)
              ? relative(uploadsDir, att.path)
              : undefined;
            images.push({
              type: "image",
              data: fileBuffer.toString("base64"),
              mimeType: att.mimeType,
              ...(uploadPath ? { uploadPath } : {}),
            });
          } else if (att.type === "audio") {
            const uploadPath = att.path.startsWith(uploadsDir)
              ? relative(uploadsDir, att.path)
              : undefined;
            if (uploadPath) {
              audioMeta.push({ uploadPath, mimeType: att.mimeType });
            }

            const transcriber = this.options.transcriber;
            if (!transcriber) {
              this.sendTo(ws, { type: "error", conversationId, error: "Audio transcription is not configured on this server" });
              continue;
            }
            const transcript = await transcriber.transcribe(fileBuffer, att.mimeType);
            if (transcript) {
              promptText = promptText
                ? `[Audio transcript]: ${transcript}\n\n${promptText}`
                : `[Audio transcript]: ${transcript}`;
            } else {
              this.sendTo(ws, { type: "error", conversationId, error: "Failed to transcribe audio" });
            }
          }
        }
      }

      // Persist audio attachment metadata as custom entries
      for (const audio of audioMeta) {
        session.sessionManager.appendCustomEntry("audio_attachment", audio);
      }

      const promptOptions: any = { streamingBehavior: "followUp" };
      if (images.length > 0) {
        promptOptions.images = images;
      }
      await session.prompt(promptText, promptOptions);

      this.sendTo(ws, { type: "turn_end", conversationId, requestId });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      console.error(`App channel error [${conversationId}]:`, errorText);
      this.sendTo(ws, { type: "error", conversationId, error: errorText });
    }
  }

  private async handleAbort(conversationId: string): Promise<void> {
    const registry = this.options.registry;
    const sessionKey: SessionKey = { channelId: "app", conversationId };

    if (!registry.has(sessionKey)) return;

    const session = await registry.getOrCreate(sessionKey);
    session.abort();

    const ws = this.conversationOwners.get(conversationId);
    if (ws) {
      this.sendTo(ws, { type: "aborted", conversationId });
    }
  }

  private async handleCloseSession(ws: AppWebSocket, conversationId: string): Promise<void> {
    const registry = this.options.registry;
    const sessionKey: SessionKey = { channelId: "app", conversationId };

    registry.dispose(sessionKey);
    this.conversationOwners.delete(conversationId);
    this.activeRequests.delete(conversationId);
    this.subscriptions.delete(conversationId);

    this.sendTo(ws, { type: "session_closed", conversationId });
  }

  // ---------------------------------------------------------------------------
  // Session browsing
  // ---------------------------------------------------------------------------

  private async handleListSessions(
    ws: AppWebSocket,
    request: Extract<AppRequest, { type: "list_sessions" }>,
  ): Promise<void> {
    const { requestId } = request;
    const sessionsDir = this.options.sessionsDir;

    try {
      const sessions: SessionInfoDTO[] = [];

      let channelDirs: string[];
      try {
        channelDirs = readdirSync(sessionsDir).filter((name) => {
          if (name === "archived") return false;
          try {
            return statSync(resolve(sessionsDir, name)).isDirectory();
          } catch {
            return false;
          }
        });
      } catch {
        channelDirs = [];
      }

      for (const channelId of channelDirs) {
        sessions.push(...this.scanChannelSessions(resolve(sessionsDir, channelId), channelId));
      }

      sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

      this.sendTo(ws, { type: "sessions_list", requestId, sessions });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "error", error: `Failed to list sessions: ${errorText}` });
    }
  }

  private async handleGetSessionEntries(
    ws: AppWebSocket,
    request: Extract<AppRequest, { type: "get_session_entries" }>,
  ): Promise<void> {
    const { requestId, sessionPath } = request;

    try {
      const sessionDir = dirname(sessionPath);
      const sm = SessionManager.open(sessionPath, sessionDir);
      const header = sm.getHeader();
      const entries = sm.getEntries();

      this.sendTo(ws, {
        type: "session_entries",
        requestId,
        header: header as object | null,
        entries: this.stripAttachmentData(entries as any[]),
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "error", error: `Failed to read session entries: ${errorText}` });
    }
  }

  private async handleRenameSession(
    ws: AppWebSocket,
    request: Extract<AppRequest, { type: "rename_session" }>,
  ): Promise<void> {
    const { requestId, sessionPath, name } = request;

    try {
      const sessionDir = dirname(sessionPath);
      const sm = SessionManager.open(sessionPath, sessionDir);
      sm.appendSessionInfo(name);
      this.sendTo(ws, { type: "rename_session_result", requestId, success: true });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "error", error: `Failed to rename session: ${errorText}` });
    }
  }

  // ---------------------------------------------------------------------------
  // Session scanning helper
  // ---------------------------------------------------------------------------

  private scanChannelSessions(channelPath: string, channelId: string): SessionInfoDTO[] {
    const sessions: SessionInfoDTO[] = [];
    let convDirs: string[];
    try {
      convDirs = readdirSync(channelPath).filter((name) => {
        try {
          return statSync(resolve(channelPath, name)).isDirectory();
        } catch {
          return false;
        }
      });
    } catch {
      return sessions;
    }

    for (const conversationId of convDirs) {
      const convPath = resolve(channelPath, conversationId);
      let jsonlFiles: string[];
      try {
        jsonlFiles = readdirSync(convPath).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }

      if (jsonlFiles.length === 0) continue;

      let mostRecent = jsonlFiles[0];
      let mostRecentMtime = 0;
      for (const f of jsonlFiles) {
        try {
          const st = statSync(resolve(convPath, f));
          if (st.mtimeMs > mostRecentMtime) {
            mostRecentMtime = st.mtimeMs;
            mostRecent = f;
          }
        } catch {
          // skip
        }
      }

      const sessionPath = resolve(convPath, mostRecent);
      try {
        const sm = SessionManager.open(sessionPath, convPath);
        const header = sm.getHeader();
        const entries = sm.getEntries();

        let messageCount = 0;
        let firstMessage = "";
        for (const entry of entries) {
          if (entry.type === "message") {
            messageCount++;
            if (!firstMessage && (entry as any).message?.role === "user") {
              const msg = (entry as any).message;
              if (typeof msg.content === "string") {
                firstMessage = msg.content.substring(0, 200);
              } else if (Array.isArray(msg.content)) {
                const textPart = msg.content.find((c: any) => c.type === "text");
                if (textPart) firstMessage = textPart.text.substring(0, 200);
              }
            }
          }
        }

        const fileStat = statSync(sessionPath);

        sessions.push({
          path: sessionPath,
          id: header?.id ?? basename(mostRecent, ".jsonl"),
          channelId,
          conversationId,
          cwd: header?.cwd ?? "",
          name: sm.getSessionName(),
          created: header?.timestamp ?? fileStat.birthtime.toISOString(),
          modified: fileStat.mtime.toISOString(),
          messageCount,
          firstMessage,
        });
      } catch (err) {
        console.warn(`Failed to read session ${sessionPath}:`, err);
      }
    }

    return sessions;
  }

  // ---------------------------------------------------------------------------
  // Session archiving
  // ---------------------------------------------------------------------------

  private async handleArchiveSession(
    ws: AppWebSocket,
    request: Extract<AppRequest, { type: "archive_session" }>,
  ): Promise<void> {
    const { requestId, sessionPath } = request;

    try {
      const conversationDir = dirname(sessionPath);
      const conversationId = basename(conversationDir);
      const archivedDir = resolve(this.options.sessionsDir, "archived");
      const targetDir = resolve(archivedDir, conversationId);

      // Close session if active in registry
      const sessionKey: SessionKey = { channelId: "app", conversationId };
      this.options.registry.dispose(sessionKey);
      this.conversationOwners.delete(conversationId);
      this.activeRequests.delete(conversationId);
      this.subscriptions.delete(conversationId);

      mkdirSync(archivedDir, { recursive: true });
      renameSync(conversationDir, targetDir);

      this.sendTo(ws, { type: "archive_session_result", requestId, success: true });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "error", error: `Failed to archive session: ${errorText}` });
    }
  }

  private async handleUnarchiveSession(
    ws: AppWebSocket,
    request: Extract<AppRequest, { type: "unarchive_session" }>,
  ): Promise<void> {
    const { requestId, sessionPath } = request;

    try {
      const conversationDir = dirname(sessionPath);
      const conversationId = basename(conversationDir);
      const appDir = resolve(this.options.sessionsDir, "app");
      const targetDir = resolve(appDir, conversationId);

      mkdirSync(appDir, { recursive: true });
      renameSync(conversationDir, targetDir);

      this.sendTo(ws, { type: "unarchive_session_result", requestId, success: true });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "error", error: `Failed to unarchive session: ${errorText}` });
    }
  }

  private async handleListArchivedSessions(
    ws: AppWebSocket,
    request: Extract<AppRequest, { type: "list_archived_sessions" }>,
  ): Promise<void> {
    const { requestId } = request;
    const archivedDir = resolve(this.options.sessionsDir, "archived");

    try {
      const sessions = this.scanChannelSessions(archivedDir, "archived");
      sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
      this.sendTo(ws, { type: "archived_sessions_list", requestId, sessions });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "error", error: `Failed to list archived sessions: ${errorText}` });
    }
  }

  // ---------------------------------------------------------------------------
  // Memory request handling
  // ---------------------------------------------------------------------------

  private async handleMemoryRequest(
    ws: AppWebSocket,
    request: Extract<AppRequest, { type: `memory_${string}` }>,
  ): Promise<void> {
    const requestId = (request as any).requestId as string;
    const memoryConfig = this.options.memoryConfig;

    if (!memoryConfig?.enabled) {
      this.sendTo(ws, { type: "memory_error", requestId, error: "Memory system is not enabled" });
      return;
    }

    try {
      const store = await MemoryStore.getInstance(memoryConfig);

      switch (request.type) {
        case "memory_list": {
          const { memories, total } = await store.list({
            limit: request.limit,
            offset: request.offset,
          });
          this.sendTo(ws, { type: "memory_list_result", requestId, memories, total });
          break;
        }

        case "memory_search": {
          const results = await store.recall({
            query: request.query,
            limit: request.limit,
            tags: request.tags,
          });
          this.sendTo(ws, { type: "memory_search_result", requestId, memories: results, count: results.length });
          break;
        }

        case "memory_save": {
          const id = await store.save(request.text, request.tags, request.source);
          this.sendTo(ws, {
            type: "memory_save_result",
            requestId,
            id,
            text: request.text,
            tags: request.tags ?? [],
          });
          break;
        }

        case "memory_update": {
          const success = await store.update(request.id, request.text, request.tags);
          this.sendTo(ws, { type: "memory_update_result", requestId, success });
          break;
        }

        case "memory_delete": {
          const success = await store.forget(request.id);
          this.sendTo(ws, { type: "memory_delete_result", requestId, success });
          break;
        }
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "memory_error", requestId, error: errorText });
    }
  }

  // ---------------------------------------------------------------------------
  // Skill request handling
  // ---------------------------------------------------------------------------

  private async handleSkillRequest(
    ws: AppWebSocket,
    request: Extract<AppRequest, { type: `${"list" | "get" | "save" | "delete"}_skill${"" | "s"}` }>,
  ): Promise<void> {
    const requestId = (request as any).requestId as string;
    const skillsDir = this.options.skillsDir;

    try {
      mkdirSync(skillsDir, { recursive: true });

      switch (request.type) {
        case "list_skills": {
          const files = readdirSync(skillsDir).filter((f) => f.endsWith(".md") || f.endsWith(".yaml") || f.endsWith(".yml") || f.endsWith(".json") || f.endsWith(".txt"));
          const skills: SkillInfoDTO[] = [];
          for (const filename of files) {
            try {
              const st = statSync(join(skillsDir, filename));
              skills.push({ filename, modified: st.mtime.toISOString(), size: st.size });
            } catch {
              // skip unreadable files
            }
          }
          this.sendTo(ws, { type: "skills_list_result", requestId, skills });
          break;
        }

        case "get_skill": {
          const filename = (request as any).filename as string;
          if (!filename || filename.includes("..") || filename.includes("/")) {
            this.sendTo(ws, { type: "skill_error", requestId, error: "Invalid filename" });
            return;
          }
          const filePath = join(skillsDir, filename);
          if (!existsSync(filePath)) {
            this.sendTo(ws, { type: "skill_error", requestId, error: "Skill not found" });
            return;
          }
          const content = readFileSync(filePath, "utf-8");
          this.sendTo(ws, { type: "skill_content_result", requestId, filename, content });
          break;
        }

        case "save_skill": {
          const filename = (request as any).filename as string;
          const content = (request as any).content as string;
          if (!filename || filename.includes("..") || filename.includes("/")) {
            this.sendTo(ws, { type: "skill_error", requestId, error: "Invalid filename" });
            return;
          }
          writeFileSync(join(skillsDir, filename), content, "utf-8");
          this.sendTo(ws, { type: "skill_save_result", requestId, success: true });
          break;
        }

        case "delete_skill": {
          const filename = (request as any).filename as string;
          if (!filename || filename.includes("..") || filename.includes("/")) {
            this.sendTo(ws, { type: "skill_error", requestId, error: "Invalid filename" });
            return;
          }
          const filePath = join(skillsDir, filename);
          if (!existsSync(filePath)) {
            this.sendTo(ws, { type: "skill_error", requestId, error: "Skill not found" });
            return;
          }
          unlinkSync(filePath);
          this.sendTo(ws, { type: "skill_delete_result", requestId, success: true });
          break;
        }
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "skill_error", requestId, error: errorText });
    }
  }

  // ---------------------------------------------------------------------------
  // Kit request handling
  // ---------------------------------------------------------------------------

  private async handleKitRequest(
    ws: AppWebSocket,
    request: Extract<AppRequest, { type: `${"list" | "enable" | "disable" | "reload" | "delete"}_kit${"" | "s"}` }>,
  ): Promise<void> {
    const requestId = (request as any).requestId as string;
    const kitsServer = this.options.kitsServer;

    if (!kitsServer) {
      this.sendTo(ws, { type: "kit_action_result", requestId, success: false, error: "Kits system is not enabled" });
      return;
    }

    try {
      switch (request.type) {
        case "list_kits": {
          const kits = kitsServer.getKits();
          this.sendTo(ws, { type: "kits_list_result", requestId, kits });
          break;
        }

        case "enable_kit": {
          const kitId = (request as any).kitId as string;
          await kitsServer.loadKit(kitId);
          this.sendTo(ws, { type: "kit_action_result", requestId, success: true });
          this.broadcastKitsChanged("enabled", kitId);
          break;
        }

        case "disable_kit": {
          const kitId = (request as any).kitId as string;
          await kitsServer.unloadKit(kitId);
          this.sendTo(ws, { type: "kit_action_result", requestId, success: true });
          this.broadcastKitsChanged("disabled", kitId);
          break;
        }

        case "reload_kit": {
          const kitId = (request as any).kitId as string;
          await kitsServer.reloadKit(kitId);
          this.sendTo(ws, { type: "kit_action_result", requestId, success: true });
          this.broadcastKitsChanged("reloaded", kitId);
          break;
        }

        case "delete_kit": {
          const kitId = (request as any).kitId as string;
          await kitsServer.unloadKit(kitId);
          // Note: actual file deletion is handled by the agent tool, not this WS message
          this.sendTo(ws, { type: "kit_action_result", requestId, success: true });
          this.broadcastKitsChanged("deleted", kitId);
          break;
        }
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.sendTo(ws, { type: "kit_action_result", requestId, success: false, error: errorText });
    }
  }

  // ---------------------------------------------------------------------------
  // Event subscription — translates AgentEvent → AppResponse
  // ---------------------------------------------------------------------------

  private ensureSubscription(conversationId: string, session: any): void {
    if (this.subscriptions.has(conversationId)) return;
    this.subscriptions.add(conversationId);

    let contentIndex = 0;

    session.subscribe((event: any) => {
      const ws = this.conversationOwners.get(conversationId);
      if (!ws) return;

      if (event.type === "turn_start") {
        contentIndex = 0;
        return;
      }

      if (event.type === "message_update") {
        const e = event.assistantMessageEvent;
        if (!e) return;

        switch (e.type) {
          case "text_delta":
            this.sendTo(ws, {
              type: "text_delta",
              conversationId,
              delta: e.delta,
              contentIndex,
            });
            break;

          case "text_start":
            contentIndex++;
            break;

          case "thinking_delta":
            this.sendTo(ws, {
              type: "thinking_delta",
              conversationId,
              delta: e.delta,
              contentIndex,
            });
            break;

          case "thinking_end":
            this.sendTo(ws, {
              type: "thinking_end",
              conversationId,
              contentIndex,
            });
            break;
        }
        return;
      }

      if (event.type === "tool_execution_start") {
        this.sendTo(ws, {
          type: "tool_start",
          conversationId,
          toolCallId: event.toolCallId ?? "",
          toolName: event.toolName ?? "",
          args: event.args ?? {},
        });
        return;
      }

      if (event.type === "tool_execution_update") {
        this.sendTo(ws, {
          type: "tool_update",
          conversationId,
          toolCallId: event.toolCallId ?? "",
          toolName: event.toolName ?? "",
          partialResult: event.partialResult ?? "",
        });
        return;
      }

      if (event.type === "tool_execution_end") {
        const resultObj = event.result;
        const details = resultObj && typeof resultObj === "object" && "details" in resultObj
          ? (resultObj as any).details
          : undefined;
        let resultText: string;
        if (typeof resultObj === "string") {
          resultText = resultObj;
        } else if (resultObj && typeof resultObj === "object" && "content" in resultObj) {
          const content = (resultObj as any).content;
          resultText = Array.isArray(content)
            ? content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n")
            : JSON.stringify(content ?? "");
        } else {
          resultText = JSON.stringify(resultObj ?? "");
        }
        this.sendTo(ws, {
          type: "tool_end",
          conversationId,
          toolCallId: event.toolCallId ?? "",
          toolName: event.toolName ?? "",
          result: resultText,
          isError: event.isError ?? false,
          ...(details !== undefined ? { details } : {}),
        });
        return;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Broadcast to all connected clients
  // ---------------------------------------------------------------------------

  broadcastArtifactsChanged(event: string, path: string): void {
    const msg: AppResponse = { type: "artifacts_changed", event, path };
    for (const ws of this.clients) {
      this.sendTo(ws, msg);
    }
  }

  broadcastKitsChanged(event: string, kitId: string): void {
    const msg: AppResponse = { type: "kits_changed", event, kitId };
    for (const ws of this.clients) {
      this.sendTo(ws, msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private sendTo(ws: AppWebSocket, response: AppResponse): void {
    ws.send(JSON.stringify(response));
  }
}
