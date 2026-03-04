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

export interface WebSearchConfig {
  provider?: "brave" | "searxng";
  apiKey?: string;
  searxngUrl?: string;
}

// ---------------------------------------------------------------------------
// Search provider interface
// ---------------------------------------------------------------------------

interface SearchProvider {
  name: string;
  search(query: string, count: number): Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// Brave provider
// ---------------------------------------------------------------------------

function createBraveProvider(apiKey: string): SearchProvider {
  return {
    name: "Brave Search",
    async search(query: string, count: number): Promise<SearchResult[]> {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`Brave Search API returned ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      };

      return (data.web?.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        description: r.description ?? "",
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// SearXNG provider
// ---------------------------------------------------------------------------

function createSearxngProvider(baseUrl: string): SearchProvider {
  return {
    name: "SearXNG",
    async search(query: string, count: number): Promise<SearchResult[]> {
      const url = new URL("/search", baseUrl);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Sam/1.0)",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };

      return (data.results ?? []).slice(0, count).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        description: r.content ?? "",
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache: Cache<SearchResult[]> = new Map();

export function createWebSearchTool(config?: WebSearchConfig): AgentTool {
  // Resolve provider once at tool creation time
  let provider: SearchProvider | undefined;
  let configError: string | undefined;

  if (config?.provider === "searxng" && config.searxngUrl) {
    provider = createSearxngProvider(config.searxngUrl);
  } else if (config?.provider !== "searxng" && config?.apiKey) {
    provider = createBraveProvider(config.apiKey);
  } else if (config?.provider === "searxng") {
    configError =
      "SearXNG is selected but no URL is configured. " +
      "Set SEARXNG_URL in .env or tools.webSearch.searxngUrl in ~/.sam/config.yaml.";
  } else {
    configError =
      "Web search is not configured. Either:\n" +
      "  • Set BRAVE_API_KEY (env or tools.webSearch.apiKey in config.yaml) for Brave Search\n" +
      '  • Set provider: "searxng" and SEARXNG_URL for SearXNG';
  }

  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web. Returns a list of results with title, URL, and description. " +
      "Use this to find current information, answer questions about recent events, or research topics.",
    parameters: Parameters,
    async execute(_toolCallId: string, raw: unknown) {
      if (!provider) {
        return errorResult(configError!);
      }

      const params = raw as Params;
      const query = params.query;
      const count = params.count ?? 5;
      const cacheKey = `${query}:${count}`;

      const cached = readCache(cache, cacheKey);
      if (cached) {
        return jsonResult({ results: cached, source: "cache" });
      }

      try {
        const results = await provider.search(query, count);

        writeCache(cache, cacheKey, results, CACHE_TTL_MS);

        const wrapped = wrapExternalContent(
          JSON.stringify(results, null, 2),
          `${provider.name}: "${query}"`,
        );

        return {
          content: [{ type: "text", text: wrapped }],
          details: undefined,
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
