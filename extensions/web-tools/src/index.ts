import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { createWebSearchTool } from "./web-search.js";
import { createWebFetchTool, formatBytes, formatDuration } from "./web-fetch.js";

// Re-export factory functions for programmatic use
export { createWebSearchTool } from "./web-search.js";
export { createWebFetchTool } from "./web-fetch.js";
export type { WebSearchConfig } from "./web-search.js";

// Pi extension entry point
export default function webToolsExtension(pi: ExtensionAPI) {
  const provider = process.env.WEB_SEARCH_PROVIDER as "brave" | "searxng" | undefined;
  const apiKey = process.env.BRAVE_API_KEY;
  const searxngUrl = process.env.SEARXNG_URL;

  const searchTool = createWebSearchTool({ provider, apiKey, searxngUrl });
  const fetchTool = createWebFetchTool();

  pi.registerTool({
    ...searchTool,
    promptSnippet: "Search the web for current information, recent events, or topics you lack knowledge about.",
    promptGuidelines: [
      "Use web_search when you need up-to-date information beyond your training data.",
      "Prefer specific, targeted queries over broad ones for better results.",
      "Follow up with web_fetch to read the full content of promising search results.",
    ],
    execute: async (toolCallId, params, signal, onUpdate, _ctx) =>
      searchTool.execute(toolCallId, params, signal, onUpdate),

    renderCall(args, theme) {
      const params = args as { query: string; count?: number };
      const name = theme.fg("toolTitle", theme.bold("web_search "));
      return new Text(`${name}${theme.fg("accent", params.query)}`, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("muted", "Searching…"), 0, 0);

      const details = result.details as
        | { query: string; provider: string; results: Array<{ title: string; url: string; description: string }> }
        | undefined;

      if (!details?.results?.length) {
        return new Text(theme.fg("dim", "No results"), 0, 0);
      }

      return {
        render(width: number) {
          const lines: string[] = [];
          for (const r of details.results) {
            let domain: string;
            try {
              domain = new URL(r.url).hostname;
            } catch {
              domain = r.url;
            }
            const styledTitle = theme.underline(theme.fg("mdLink", r.title));
            const linkedTitle = `\x1b]8;;${r.url}\x1b\\${styledTitle}\x1b]8;;\x1b\\`;
            const host = theme.fg("dim", `  ${domain}`);
            lines.push(truncateToWidth(`  • ${linkedTitle}${host}`, width));
          }
          return lines;
        },
        invalidate() {},
      };
    },
  });

  pi.registerTool({
    ...fetchTool,
    promptSnippet: "Fetch and extract readable text content from a web page URL.",
    promptGuidelines: [
      "Use web_fetch to read articles, documentation, or any web page found via web_search.",
      "The fetched content is always saved to a temp file. The tool returns only metadata (file path, size, line/word counts) — not the content itself.",
      "To read the content, use the `read` tool on the returned file path. Read the whole file for short pages, or use offset/limit for long pages.",
      "Content is extracted using Readability — it works best on article-style pages.",
    ],
    execute: async (toolCallId, params, signal, onUpdate, _ctx) =>
      fetchTool.execute(toolCallId, params, signal, onUpdate),

    renderResult(result, { isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("muted", "Fetching…"), 0, 0);

      const details = result.details as
        | {
            url: string;
            title: string;
            description?: string;
            tmpFile: string;
            fileSize: number;
            totalLines: number;
            totalWords: number;
            totalChars: number;
            durationMs: number;
            cached: boolean;
          }
        | undefined;

      if (!details) {
        return new Text(theme.fg("dim", "No content"), 0, 0);
      }

      return {
        render(width: number) {
          const lines: string[] = [];

          const title = details.title || details.url;
          const styledTitle = theme.bold(title);
          const linkedTitle = `\x1b]8;;${details.url}\x1b\\${styledTitle}\x1b]8;;\x1b\\`;
          lines.push(truncateToWidth(`  ${linkedTitle}`, width));

          if (details.description) {
            lines.push(truncateToWidth(`  ${theme.fg("dim", details.description)}`, width));
          }

          const meta: string[] = [];
          meta.push(`${details.totalLines} lines`);
          meta.push(`${details.totalWords} words`);
          meta.push(formatBytes(details.fileSize));
          meta.push(formatDuration(details.durationMs));
          if (details.cached) meta.push("cached");
          lines.push(truncateToWidth(`  ${theme.fg("dim", meta.join(" · "))}`, width));

          lines.push(truncateToWidth(`  ${theme.fg("dim", details.tmpFile)}`, width));

          return lines;
        },
        invalidate() {},
      };
    },
  });
}
