import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { errorResult, readCache, writeCache, wrapExternalContent, type Cache } from "./util.js";

const TIME_RANGES = ["day", "week", "month", "year"] as const;
const TOPICS = ["general", "news", "finance"] as const;

type TimeRange = (typeof TIME_RANGES)[number];
type Topic = (typeof TOPICS)[number];

interface Params {
  query: string;
  count?: number;
  time_range?: TimeRange;
  topic?: Topic;
  include_domains?: string[];
}

// String enums are emitted as `{ type: "string", enum: [...] }` rather than
// Type.Union([Type.Literal(...)]): the anyOf/const form is not understood by
// every model provider, and the agent-sdk tool bridge degrades it to `any`.
function buildParameters(providerName: WebSearchProviderName | undefined) {
  return Type.Object({
    query: Type.String({ description: "The search query" }),
    count: Type.Optional(
      Type.Number({ description: "Number of results (1-10)", minimum: 1, maximum: 10, default: 5 }),
    ),
    time_range: Type.Optional(
      Type.Unsafe<TimeRange>({
        type: "string",
        enum: [...TIME_RANGES],
        description: "Only return results published within the last day, week, month, or year",
      }),
    ),
    // Only Tavily has search categories, so other providers do not advertise the parameter.
    ...(providerName === "tavily"
      ? {
          topic: Type.Optional(
            Type.Unsafe<Topic>({
              type: "string",
              enum: [...TOPICS],
              description:
                'Search category: "news" for current events and recent coverage, ' +
                '"finance" for markets and companies, "general" (default) for everything else',
            }),
          ),
        }
      : {}),
    include_domains: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Restrict results to these domains, e.g. ["github.com", "docs.python.org"]',
        maxItems: 10,
      }),
    ),
  });
}

interface SearchResult {
  title: string;
  url: string;
  description: string;
  favicon?: string;
  thumbnail?: string;
  age?: string;
  siteName?: string;
}

export type WebSearchProviderName = "brave" | "tavily" | "searxng";

export interface WebSearchConfig {
  provider?: WebSearchProviderName;
  /** API key of the selected provider (Brave or Tavily). */
  apiKey?: string;
  searxngUrl?: string;
  tavily?: {
    /** "basic" costs 1 API credit per search, "advanced" costs 2. Default: "basic". */
    searchDepth?: "basic" | "advanced";
  };
}

const PROVIDER_NAMES: readonly string[] = ["brave", "tavily", "searxng"];

/**
 * Fill in a web search config from environment variables.
 *
 * The provider is a choice, so an explicit one in the config wins; otherwise it
 * comes from WEB_SEARCH_PROVIDER, then from whichever API key is present.
 * WEB_SEARCH_PROVIDER is often exported shell-wide for the standalone pi
 * extension and must not silently override a provider picked in config.yaml.
 *
 * Credentials and URLs are the other way round, as everywhere else in Sam: the
 * selected provider's env var wins over the config.
 */
export function resolveWebSearchEnv(
  base?: WebSearchConfig,
  env: Record<string, string | undefined> = process.env,
): WebSearchConfig {
  const provider =
    base?.provider ||
    // `||` so that an empty `WEB_SEARCH_PROVIDER=` line in .env counts as unset
    (env.WEB_SEARCH_PROVIDER as WebSearchProviderName | undefined) ||
    (env.BRAVE_API_KEY || base?.apiKey ? "brave" : env.TAVILY_API_KEY ? "tavily" : undefined);

  const envKey =
    provider === "tavily" ? env.TAVILY_API_KEY : provider === "searxng" ? undefined : env.BRAVE_API_KEY;

  return {
    ...base,
    provider,
    apiKey: envKey || base?.apiKey,
    searxngUrl: env.SEARXNG_URL || base?.searxngUrl,
  };
}

// ---------------------------------------------------------------------------
// Search provider interface
// ---------------------------------------------------------------------------

interface SearchOptions {
  count: number;
  timeRange?: TimeRange;
  topic?: Topic;
  includeDomains?: string[];
}

interface SearchProvider {
  name: string;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}

/** Restrict a query to a set of domains for engines that only understand `site:`. */
function withSiteFilter(query: string, domains?: string[]): string {
  if (!domains?.length) return query;
  const sites = domains.map((d) => `site:${d}`);
  return sites.length === 1 ? `${query} ${sites[0]}` : `${query} (${sites.join(" OR ")})`;
}

// ---------------------------------------------------------------------------
// Brave provider
// ---------------------------------------------------------------------------

const BRAVE_FRESHNESS: Record<TimeRange, string> = { day: "pd", week: "pw", month: "pm", year: "py" };

function createBraveProvider(apiKey: string): SearchProvider {
  return {
    name: "Brave Search",
    async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", withSiteFilter(query, options.includeDomains));
      url.searchParams.set("count", String(options.count));
      if (options.timeRange) {
        url.searchParams.set("freshness", BRAVE_FRESHNESS[options.timeRange]);
      }

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
        web?: {
          results?: Array<{
            title?: string;
            url?: string;
            description?: string;
            age?: string;
            meta_url?: { favicon?: string; hostname?: string };
            thumbnail?: { src?: string };
            profile?: { name?: string };
          }>;
        };
      };

      return (data.web?.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        description: r.description ?? "",
        favicon: r.meta_url?.favicon,
        thumbnail: r.thumbnail?.src,
        age: r.age,
        siteName: r.profile?.name || r.meta_url?.hostname,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Tavily provider
// ---------------------------------------------------------------------------

const TAVILY_ERROR_HINTS: Record<number, string> = {
  401: "the API key is missing or invalid",
  429: "rate limit exceeded, retry shortly",
  432: "the plan's credit limit is used up",
  433: "the pay-as-you-go spending limit is used up",
};

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function formatPublishedDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

function createTavilyProvider(apiKey: string, searchDepth: "basic" | "advanced"): SearchProvider {
  return {
    name: "Tavily",
    async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: options.count,
          search_depth: searchDepth,
          include_favicon: true,
          ...(options.topic && { topic: options.topic }),
          ...(options.timeRange && { time_range: options.timeRange }),
          ...(options.includeDomains?.length && { include_domains: options.includeDomains }),
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        // Tavily reports failures as { detail: { error: "..." } }
        const body = (await response.json().catch(() => undefined)) as
          | { detail?: { error?: string } | string }
          | undefined;
        const detail = typeof body?.detail === "string" ? body.detail : body?.detail?.error;
        const reason = detail ?? TAVILY_ERROR_HINTS[response.status] ?? response.statusText;
        throw new Error(`Tavily API returned ${response.status}: ${reason}`);
      }

      const data = (await response.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          favicon?: string;
          published_date?: string;
        }>;
      };

      return (data.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        description: r.content ?? "",
        favicon: r.favicon || undefined,
        age: formatPublishedDate(r.published_date),
        siteName: hostnameOf(r.url ?? ""),
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// SearXNG provider
// ---------------------------------------------------------------------------

// SearXNG's search API only documents day, month and year.
const SEARXNG_TIME_RANGE: Record<TimeRange, string> = { day: "day", week: "month", month: "month", year: "year" };

function createSearxngProvider(baseUrl: string): SearchProvider {
  return {
    name: "SearXNG",
    async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
      const url = new URL("/search", baseUrl);
      url.searchParams.set("q", withSiteFilter(query, options.includeDomains));
      url.searchParams.set("format", "json");
      if (options.timeRange) {
        url.searchParams.set("time_range", SEARXNG_TIME_RANGE[options.timeRange]);
      }

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
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          img_src?: string;
          thumbnail_src?: string;
        }>;
      };

      return (data.results ?? []).slice(0, options.count).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        description: r.content ?? "",
        thumbnail: r.img_src || r.thumbnail_src,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface CachedSearch {
  results: SearchResult[];
  providerName: string;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache: Cache<CachedSearch> = new Map();

function resolveProvider(config?: WebSearchConfig): { provider?: SearchProvider; configError?: string } {
  // An API key with no provider named has always meant Brave.
  const name: string | undefined = config?.provider ?? (config?.apiKey ? "brave" : undefined);

  switch (name) {
    case "brave":
      if (config?.apiKey) return { provider: createBraveProvider(config.apiKey) };
      return {
        configError:
          "Brave Search is selected but no API key is configured. " +
          "Set BRAVE_API_KEY in .env or tools.webSearch.apiKey in ~/.sam/config.yaml.",
      };
    case "tavily":
      if (config?.apiKey) {
        return { provider: createTavilyProvider(config.apiKey, config.tavily?.searchDepth ?? "basic") };
      }
      return {
        configError:
          "Tavily is selected but no API key is configured. " +
          "Set TAVILY_API_KEY in .env or tools.webSearch.apiKey in ~/.sam/config.yaml.",
      };
    case "searxng":
      if (config?.searxngUrl) return { provider: createSearxngProvider(config.searxngUrl) };
      return {
        configError:
          "SearXNG is selected but no URL is configured. " +
          "Set SEARXNG_URL in .env or tools.webSearch.searxngUrl in ~/.sam/config.yaml.",
      };
    case undefined:
      return {
        configError:
          "Web search is not configured. Either:\n" +
          "  • Set BRAVE_API_KEY (env or tools.webSearch.apiKey in config.yaml) for Brave Search\n" +
          '  • Set provider: "tavily" and TAVILY_API_KEY for Tavily\n' +
          '  • Set provider: "searxng" and SEARXNG_URL for SearXNG',
      };
    default:
      return {
        configError:
          `Unknown web search provider "${name}". ` + `Supported providers: ${PROVIDER_NAMES.join(", ")}.`,
      };
  }
}

export function createWebSearchTool(config?: WebSearchConfig): AgentTool {
  // Resolve provider once at tool creation time
  const { provider, configError } = resolveProvider(config);

  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web. Returns a list of results with title, URL, and description. " +
      "Use this to find current information, answer questions about recent events, or research topics. " +
      "Results can be limited to a recent time window or to specific domains.",
    parameters: buildParameters(provider ? config?.provider ?? "brave" : undefined),
    async execute(_toolCallId: string, raw: unknown) {
      if (!provider) {
        return errorResult(configError!);
      }

      const params = raw as Params;
      const query = params.query;
      const options: SearchOptions = {
        count: params.count ?? 5,
        timeRange: params.time_range,
        topic: params.topic,
        includeDomains: params.include_domains?.length ? params.include_domains : undefined,
      };
      const cacheKey = JSON.stringify([
        provider.name,
        query,
        options.count,
        options.timeRange ?? null,
        options.topic ?? null,
        options.includeDomains ?? null,
      ]);

      const cached = readCache(cache, cacheKey);
      if (cached) {
        return {
          content: [{ type: "text", text: wrapExternalContent(
            JSON.stringify(cached.results, null, 2),
            `${cached.providerName}: "${query}" (cached)`,
          ) }],
          details: { query, provider: cached.providerName, results: cached.results },
        };
      }

      try {
        const results = await provider.search(query, options);

        writeCache(cache, cacheKey, { results, providerName: provider.name }, CACHE_TTL_MS);

        const wrapped = wrapExternalContent(
          JSON.stringify(results, null, 2),
          `${provider.name}: "${query}"`,
        );

        return {
          content: [{ type: "text", text: wrapped }],
          details: { query, provider: provider.name, results },
        };
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
