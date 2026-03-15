import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { createWebSearchTool } from "./web-search.js";
import { createWebFetchTool } from "./web-fetch.js";

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
      "The default limit is 20,000 characters. Use the maxChars parameter to request more or less content.",
      "Content is extracted using Readability — it works best on article-style pages.",
    ],
    execute: async (toolCallId, params, signal, onUpdate, _ctx) =>
      fetchTool.execute(toolCallId, params, signal, onUpdate),

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("muted", "Fetching…"), 0, 0);

      const details = result.details as
        | { url: string; title: string; description?: string; contentLength: number; truncated: boolean }
        | undefined;

      if (!details) {
        return new Text(theme.fg("dim", "No content"), 0, 0);
      }

      const content = result.content[0];
      const textContent = content?.type === "text" ? content.text : "";

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
          meta.push(`${details.contentLength} chars`);
          if (details.truncated) meta.push("truncated");
          lines.push(truncateToWidth(`  ${theme.fg("dim", meta.join(" · "))}`, width));

          if (expanded && textContent) {
            lines.push("");
            // Extract a plain-text excerpt from the JSON-wrapped content
            let excerpt = "";
            try {
              const parsed = JSON.parse(textContent.replace(/<<<.*?>>>/gs, "").trim());
              excerpt = parsed.content ?? "";
            } catch {
              excerpt = textContent;
            }
            const previewLines = excerpt.split("\n").slice(0, 20);
            for (const line of previewLines) {
              lines.push(truncateToWidth(`  ${theme.fg("dim", line)}`, width));
            }
            const totalLines = excerpt.split("\n").length;
            if (totalLines > 20) {
              lines.push(truncateToWidth(`  ${theme.fg("muted", `… ${totalLines - 20} more lines`)}`, width));
            }
          }

          return lines;
        },
        invalidate() {},
      };
    },
  });
}
