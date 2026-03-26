import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import TurndownService from "turndown";
import { errorResult, readCache, writeCache, wrapExternalContent, type Cache } from "./util.js";

const Parameters = Type.Object({
  url: Type.String({ description: "The URL to fetch (must start with http:// or https://)" }),
  maxLines: Type.Optional(
    Type.Number({ description: "Maximum lines of markdown to return inline. If content exceeds this, full content is written to a tmp file.", default: 200 }),
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
  markdown: string;
  meta: PageMeta;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache: Cache<FetchedPage> = new Map();

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

function tmpPath(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  return `/tmp/web-fetch-${hash}.md`;
}

function formatResult(markdown: string, maxLines: number, url: string) {
  const lines = markdown.split("\n");
  const totalLines = lines.length;
  const totalWords = markdown.split(/\s+/).filter(Boolean).length;
  const totalChars = markdown.length;

  if (totalLines <= maxLines) {
    return { text: markdown, truncated: false, tmpFile: undefined, totalLines, totalWords, totalChars };
  }

  const filePath = tmpPath(url);
  writeFileSync(filePath, markdown);

  const text = lines.slice(0, maxLines).join("\n") +
    `\n\n<content truncated at ${maxLines} lines. Full content available at ${filePath}. Total ${totalLines} lines, ${totalWords} words, ${totalChars} characters>`;

  return { text, truncated: true, tmpFile: filePath, totalLines, totalWords, totalChars };
}

export function createWebFetchTool(): AgentTool {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a web page and extract its content as clean markdown. " +
      "Use this to read articles, documentation, or any web page. " +
      "Returns structured markdown preserving headings, links, lists, and code blocks.",
    parameters: Parameters,
    async execute(_toolCallId: string, raw: unknown) {
      const params = raw as Params;
      const { url } = params;
      const maxLines = params.maxLines ?? 200;

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return errorResult("URL must start with http:// or https://");
      }

      const cached = readCache(cache, url);
      if (cached) {
        const { text, truncated, tmpFile, totalLines, totalWords, totalChars } = formatResult(cached.markdown, maxLines, url);
        const wrapped = wrapExternalContent(text, url);
        return {
          content: [{ type: "text", text: wrapped }],
          details: {
            url,
            title: cached.title,
            ...cached.meta,
            totalLines,
            totalWords,
            totalChars,
            truncated,
            tmpFile,
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

      const { text, truncated, tmpFile, totalLines, totalWords, totalChars } = formatResult(markdown, maxLines, url);
      const wrapped = wrapExternalContent(text, url);

      return {
        content: [{ type: "text", text: wrapped }],
        details: {
          url,
          title,
          ...meta,
          totalLines,
          totalWords,
          totalChars,
          truncated,
          tmpFile,
        },
      };
    },
  };
}
