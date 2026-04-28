import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import TurndownService from "turndown";
import { errorResult, readCache, writeCache, type Cache } from "./util.js";

const Parameters = Type.Object({
  url: Type.String({ description: "The URL to fetch (must start with http:// or https://)" }),
});

type Params = Static<typeof Parameters>;

interface PageMeta {
  description?: string;
  siteName?: string;
  image?: string;
  favicon?: string;
}

interface FetchedPage {
  url: string;
  title: string;
  markdown: string;
  meta: PageMeta;
}

interface FileStats {
  tmpFile: string;
  fileSize: number;
  totalLines: number;
  totalWords: number;
  totalChars: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache: Cache<FetchedPage> = new Map();

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  const kb = n / 1024;
  if (kb < 1024) return kb < 10 ? `${kb.toFixed(1)}KB` : `${Math.round(kb)}KB`;
  const mb = kb / 1024;
  return mb < 10 ? `${mb.toFixed(1)}MB` : `${Math.round(mb)}MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function tmpPath(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  return join(tmpdir(), `web-fetch-${hash}.md`);
}

function writeAndStat(markdown: string, url: string): FileStats {
  const tmpFile = tmpPath(url);
  writeFileSync(tmpFile, markdown);
  const fileSize = statSync(tmpFile).size;
  const totalLines = markdown.split("\n").length;
  const totalWords = markdown.split(/\s+/).filter(Boolean).length;
  const totalChars = markdown.length;
  return { tmpFile, fileSize, totalLines, totalWords, totalChars };
}

function buildAgentText(args: {
  title: string;
  url: string;
  durationMs: number;
  file: FileStats;
}): string {
  const { title, url, durationMs, file } = args;
  const head = title
    ? `Fetched "${title}" from ${url} in ${formatDuration(durationMs)}`
    : `Fetched ${url} in ${formatDuration(durationMs)}`;
  const tail = `Content saved to ${file.tmpFile} (${formatBytes(file.fileSize)}, ${file.totalWords} words, ${file.totalLines} lines)`;
  return `${head}\n${tail}`;
}

export function createWebFetchTool(): AgentTool {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a web page and extract its content as clean markdown. " +
      "Use this to read articles, documentation, or any web page. " +
      "The full content is saved to a temp file; the tool returns only metadata (file path, size, line/word counts). " +
      "Use a file-reading tool on the returned path to access the content.",
    parameters: Parameters,
    async execute(_toolCallId: string, raw: unknown) {
      const params = raw as Params;
      const { url } = params;
      const start = Date.now();

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return errorResult("URL must start with http:// or https://");
      }

      const cached = readCache(cache, url);
      if (cached) {
        const file = writeAndStat(cached.markdown, url);
        const durationMs = Date.now() - start;
        const text = buildAgentText({ title: cached.title, url, durationMs, file });
        return {
          content: [{ type: "text", text }],
          details: {
            url,
            title: cached.title,
            ...cached.meta,
            ...file,
            durationMs,
            cached: true,
          },
        };
      }

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": "Sam-AI-Assistant/1.0 (compatible; bot)",
            Accept: "text/html,application/xhtml+xml,text/plain",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        return errorResult(`Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (!response.ok) {
        return errorResult(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      // Extract OG/meta tags from a fresh parse (before Readability mutates the DOM)
      let meta: PageMeta = {};
      try {
        const { document: metaDoc } = parseHTML(html);
        const getMeta = (sel: string) =>
          (metaDoc.querySelector(sel) as any)?.getAttribute?.("content") || undefined;
        meta = {
          description:
            getMeta('meta[property="og:description"]') ??
            getMeta('meta[name="description"]'),
          image: getMeta('meta[property="og:image"]'),
          siteName: getMeta('meta[property="og:site_name"]'),
          favicon:
            (metaDoc.querySelector('link[rel="icon"]') as any)?.getAttribute?.("href") ||
            (metaDoc.querySelector('link[rel="shortcut icon"]') as any)?.getAttribute?.("href") ||
            undefined,
        };
        if (meta.favicon && !meta.favicon.startsWith("http")) {
          try {
            meta.favicon = new URL(meta.favicon, url).href;
          } catch { /* leave as-is */ }
        }
        if (meta.image && !meta.image.startsWith("http")) {
          try {
            meta.image = new URL(meta.image, url).href;
          } catch { /* leave as-is */ }
        }
      } catch {
        // meta extraction failed — not critical
      }

      // Extract content as markdown via Readability + turndown
      let title = "";
      let markdown = "";

      try {
        const { document } = parseHTML(html);
        const reader = new Readability(document as unknown as Document);
        const article = reader.parse();
        if (article) {
          title = article.title ?? "";
          markdown = turndown.turndown(article.content ?? "");
        }
      } catch {
        // Readability failed — fall through to fallback
      }

      // Fallback: convert full body HTML to markdown
      if (!markdown) {
        try {
          const { document } = parseHTML(html);
          title = document.querySelector("title")?.textContent ?? "";
          const bodyHtml = document.body?.innerHTML ?? html;
          markdown = turndown.turndown(bodyHtml);
        } catch {
          // Last resort: strip tags
          markdown = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        }
      }

      if (title) {
        markdown = `# ${title}\n\n${markdown}`;
      }

      const page: FetchedPage = { url, title, markdown, meta };
      writeCache(cache, url, page, CACHE_TTL_MS);

      const file = writeAndStat(markdown, url);
      const durationMs = Date.now() - start;
      const text = buildAgentText({ title, url, durationMs, file });

      return {
        content: [{ type: "text", text }],
        details: {
          url,
          title,
          ...meta,
          ...file,
          durationMs,
          cached: false,
        },
      };
    },
  };
}
