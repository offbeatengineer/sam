import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { errorResult, readCache, writeCache, wrapExternalContent, type Cache } from "./util.js";

const Parameters = Type.Object({
  url: Type.String({ description: "The URL to fetch (must start with http:// or https://)" }),
  maxChars: Type.Optional(
    Type.Number({ description: "Maximum characters of content to return", default: 20000 }),
  ),
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
  content: string;
  contentLength: number;
  meta: PageMeta;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache: Cache<FetchedPage> = new Map();

export function createWebFetchTool(): AgentTool {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a web page and extract its readable text content. " +
      "Use this to read articles, documentation, or any web page. " +
      "Returns the page title and cleaned text content.",
    parameters: Parameters,
    async execute(_toolCallId: string, raw: unknown) {
      const params = raw as Params;
      const { url } = params;
      const maxChars = params.maxChars ?? 20_000;

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return errorResult("URL must start with http:// or https://");
      }

      const cached = readCache(cache, url);
      if (cached) {
        const truncated = cached.content.length > maxChars;
        const page = { ...cached, content: cached.content.slice(0, maxChars) };
        const wrapped = wrapExternalContent(JSON.stringify(page, null, 2), url);
        return {
          content: [{ type: "text", text: wrapped }],
          details: {
            url,
            title: cached.title,
            ...cached.meta,
            contentLength: cached.contentLength,
            truncated,
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
        // Resolve relative favicon to absolute
        if (meta.favicon && !meta.favicon.startsWith("http")) {
          try {
            meta.favicon = new URL(meta.favicon, url).href;
          } catch { /* leave as-is */ }
        }
        // Resolve relative image to absolute
        if (meta.image && !meta.image.startsWith("http")) {
          try {
            meta.image = new URL(meta.image, url).href;
          } catch { /* leave as-is */ }
        }
      } catch {
        // meta extraction failed — not critical
      }

      // Try Readability extraction
      let title = "";
      let content = "";

      try {
        const { document } = parseHTML(html);
        const reader = new Readability(document as unknown as Document);
        const article = reader.parse();
        if (article?.textContent) {
          title = article.title ?? "";
          content = article.textContent;
        }
      } catch {
        // Readability failed — fall through to raw text fallback
      }

      // Fallback: strip tags and use raw text
      if (!content) {
        try {
          const { document } = parseHTML(html);
          title = document.querySelector("title")?.textContent ?? "";
          content = document.body?.textContent ?? html;
        } catch {
          content = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        }
      }

      const fullLength = content.length;
      const page: FetchedPage = {
        url,
        title,
        content,
        contentLength: fullLength,
        meta,
      };

      writeCache(cache, url, page, CACHE_TTL_MS);

      const isTruncated = fullLength > maxChars;
      const truncatedPage = { ...page, content: content.slice(0, maxChars) };
      if (isTruncated) {
        (truncatedPage as any).truncated = true;
      }

      const wrapped = wrapExternalContent(JSON.stringify(truncatedPage, null, 2), url);
      return {
        content: [{ type: "text", text: wrapped }],
        details: {
          url,
          title,
          ...meta,
          contentLength: fullLength,
          truncated: isTruncated,
        },
      };
    },
  };
}
