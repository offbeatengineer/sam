import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { jsonResult, errorResult, readCache, writeCache, wrapExternalContent, type Cache } from "./util.js";

const Parameters = Type.Object({
  query: Type.String({ description: "The search query" }),
  count: Type.Optional(
    Type.Number({ description: "Number of results (1-10)", minimum: 1, maximum: 10, default: 5 }),
  ),
});

type Params = Static<typeof Parameters>;

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache: Cache<SearchResult[]> = new Map();

export function createWebSearchTool(apiKey?: string): AgentTool {
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using Brave Search. Returns a list of results with title, URL, and description. " +
      "Use this to find current information, answer questions about recent events, or research topics.",
    parameters: Parameters,
    async execute(_toolCallId: string, raw: unknown) {
      const params = raw as Params;
      const key = apiKey ?? process.env.BRAVE_API_KEY;
      if (!key) {
        return errorResult(
          "Brave Search API key is not configured. " +
            "Set BRAVE_API_KEY in .env or tools.webSearch.apiKey in ~/.sam/config.yaml.",
        );
      }

      const query = params.query;
      const count = params.count ?? 5;
      const cacheKey = `${query}:${count}`;

      const cached = readCache(cache, cacheKey);
      if (cached) {
        return jsonResult({
          results: cached,
          source: "cache",
        });
      }

      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": key,
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return errorResult(`Brave Search API returned ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      };

      const results: SearchResult[] = (data.web?.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        description: r.description ?? "",
      }));

      writeCache(cache, cacheKey, results, CACHE_TTL_MS);

      const wrapped = wrapExternalContent(
        JSON.stringify(results, null, 2),
        `Brave Search: "${query}"`,
      );

      return {
        content: [{ type: "text", text: wrapped }],
        details: undefined,
      };
    },
  };
}
