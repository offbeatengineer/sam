import { afterEach, describe, expect, test } from "bun:test";
import { createWebSearchTool, resolveWebSearchEnv, type WebSearchConfig } from "./web-search.js";

// ---------------------------------------------------------------------------
// fetch stub
// ---------------------------------------------------------------------------

interface FetchCall {
  url: URL;
  init?: RequestInit;
  body?: Record<string, unknown>;
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(body: unknown, status = 200): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      init,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

// The result cache is module-level, so every search uses its own query.
let querySeq = 0;
const uniqueQuery = (label: string) => `${label} #${++querySeq}`;

async function run(config: WebSearchConfig | undefined, params: Record<string, unknown>) {
  const result = await createWebSearchTool(config).execute("call-1", params as never);
  const first = result.content[0];
  return {
    text: first?.type === "text" ? first.text : "",
    details: result.details as { query: string; provider: string; results: Array<Record<string, unknown>> } | undefined,
  };
}

const TAVILY: WebSearchConfig = { provider: "tavily", apiKey: "tvly-test" };

// ---------------------------------------------------------------------------
// resolveWebSearchEnv
// ---------------------------------------------------------------------------

describe("resolveWebSearchEnv", () => {
  test("infers the provider from whichever API key is set, Brave first", () => {
    expect(resolveWebSearchEnv(undefined, { TAVILY_API_KEY: "t" })).toMatchObject({ provider: "tavily", apiKey: "t" });
    expect(resolveWebSearchEnv(undefined, { BRAVE_API_KEY: "b", TAVILY_API_KEY: "t" })).toMatchObject({
      provider: "brave",
      apiKey: "b",
    });
    expect(resolveWebSearchEnv(undefined, {}).provider).toBeUndefined();
  });

  test("a config apiKey with no provider still means Brave", () => {
    expect(resolveWebSearchEnv({ apiKey: "yaml" }, { TAVILY_API_KEY: "t" })).toMatchObject({
      provider: "brave",
      apiKey: "yaml",
    });
  });

  test("only the selected provider's env key is used", () => {
    expect(resolveWebSearchEnv({ provider: "tavily", apiKey: "yaml" }, { BRAVE_API_KEY: "b" })).toMatchObject({
      provider: "tavily",
      apiKey: "yaml",
    });
    expect(resolveWebSearchEnv({ provider: "tavily", apiKey: "yaml" }, { TAVILY_API_KEY: "t" }).apiKey).toBe("t");
  });

  test("a provider picked in the config is not overridden by a shell-wide WEB_SEARCH_PROVIDER", () => {
    const env = { WEB_SEARCH_PROVIDER: "searxng", SEARXNG_URL: "http://127.0.0.1:8888", TAVILY_API_KEY: "t" };
    expect(resolveWebSearchEnv({ provider: "tavily" }, env)).toMatchObject({ provider: "tavily", apiKey: "t" });
  });

  test("WEB_SEARCH_PROVIDER applies when the config picks nothing, and an empty value counts as unset", () => {
    expect(resolveWebSearchEnv({}, { WEB_SEARCH_PROVIDER: "tavily", TAVILY_API_KEY: "t", BRAVE_API_KEY: "b" })).toMatchObject({
      provider: "tavily",
      apiKey: "t",
    });
    expect(resolveWebSearchEnv({}, { WEB_SEARCH_PROVIDER: "", TAVILY_API_KEY: "t" }).provider).toBe("tavily");
  });

  test("env vars still win for credentials and URLs", () => {
    const base: WebSearchConfig = { provider: "searxng", searxngUrl: "http://localhost:8888" };
    expect(resolveWebSearchEnv(base, { SEARXNG_URL: "http://127.0.0.1:8888" }).searxngUrl).toBe("http://127.0.0.1:8888");
  });

  test("keeps provider-specific settings", () => {
    const resolved = resolveWebSearchEnv({ provider: "tavily", tavily: { searchDepth: "advanced" } }, {});
    expect(resolved.tavily?.searchDepth).toBe("advanced");
  });
});

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

describe("provider selection", () => {
  test("Tavily without an API key reports how to configure it, without calling out", async () => {
    const calls = stubFetch({});
    const { text, details } = await run({ provider: "tavily" }, { query: uniqueQuery("no key") });
    expect(text).toContain("TAVILY_API_KEY");
    expect(details).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("a Tavily key is never sent to Brave", async () => {
    const calls = stubFetch({ results: [] });
    await run(TAVILY, { query: uniqueQuery("routing") });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.hostname).toBe("api.tavily.com");
  });

  test("an API key with no provider uses Brave", async () => {
    const calls = stubFetch({ web: { results: [] } });
    const { details } = await run({ apiKey: "brave-key" }, { query: uniqueQuery("legacy") });
    expect(calls[0].url.hostname).toBe("api.search.brave.com");
    expect(details?.provider).toBe("Brave Search");
  });

  test("an unknown provider is an error rather than a silent fallback", async () => {
    const calls = stubFetch({});
    const { text } = await run({ provider: "bing", apiKey: "k" } as unknown as WebSearchConfig, {
      query: uniqueQuery("unknown"),
    });
    expect(text).toContain('Unknown web search provider "bing"');
    expect(calls).toHaveLength(0);
  });

  test("nothing configured lists every provider", async () => {
    const { text } = await run(undefined, { query: uniqueQuery("unconfigured") });
    expect(text).toContain("BRAVE_API_KEY");
    expect(text).toContain("TAVILY_API_KEY");
    expect(text).toContain("SEARXNG_URL");
  });
});

// ---------------------------------------------------------------------------
// Parameter schema
// ---------------------------------------------------------------------------

describe("parameter schema", () => {
  const propsOf = (config: WebSearchConfig) =>
    (createWebSearchTool(config).parameters as unknown as { properties: Record<string, any> }).properties;

  test("topic is only offered by Tavily", () => {
    expect(propsOf(TAVILY).topic).toBeDefined();
    expect(propsOf({ provider: "brave", apiKey: "k" }).topic).toBeUndefined();
    expect(propsOf({ provider: "searxng", searxngUrl: "http://localhost:8888" }).topic).toBeUndefined();
  });

  test("enums are plain string enums, which the agent-sdk tool bridge understands", () => {
    const props = propsOf(TAVILY);
    expect(props.time_range).toMatchObject({ type: "string", enum: ["day", "week", "month", "year"] });
    expect(props.topic).toMatchObject({ type: "string", enum: ["general", "news", "finance"] });
    expect(props.time_range.anyOf).toBeUndefined();
    expect(props.include_domains).toMatchObject({ type: "array", items: { type: "string" } });
  });
});

// ---------------------------------------------------------------------------
// Tavily
// ---------------------------------------------------------------------------

describe("Tavily", () => {
  test("sends the query, filters and credentials", async () => {
    const calls = stubFetch({ results: [] });
    const query = uniqueQuery("tavily request");
    await run(
      { ...TAVILY, tavily: { searchDepth: "advanced" } },
      { query, count: 3, time_range: "week", topic: "news", include_domains: ["github.com"] },
    );

    expect(calls[0].url.href).toBe("https://api.tavily.com/search");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tvly-test");
    expect(calls[0].body).toEqual({
      query,
      max_results: 3,
      search_depth: "advanced",
      include_favicon: true,
      topic: "news",
      time_range: "week",
      include_domains: ["github.com"],
    });
  });

  test("defaults to five basic-depth results and leaves unset filters out", async () => {
    const calls = stubFetch({ results: [] });
    const query = uniqueQuery("tavily defaults");
    await run(TAVILY, { query, include_domains: [] });
    expect(calls[0].body).toEqual({ query, max_results: 5, search_depth: "basic", include_favicon: true });
  });

  test("maps results onto the shape the clients render", async () => {
    stubFetch({
      results: [
        {
          title: "Bun 2.0",
          url: "https://www.example.com/bun",
          content: "Bun 2.0 is out.",
          score: 0.91,
          favicon: "https://www.example.com/favicon.ico",
          published_date: "Tue, 15 Sep 2026 08:30:00 GMT",
        },
        { title: "No extras", url: "not a url", content: "plain" },
      ],
    });
    const query = uniqueQuery("tavily mapping");
    const { text, details } = await run(TAVILY, { query });

    expect(details).toEqual({
      query,
      provider: "Tavily",
      results: [
        {
          title: "Bun 2.0",
          url: "https://www.example.com/bun",
          description: "Bun 2.0 is out.",
          favicon: "https://www.example.com/favicon.ico",
          age: "2026-09-15",
          siteName: "example.com",
        },
        { title: "No extras", url: "not a url", description: "plain", favicon: undefined, age: undefined, siteName: undefined },
      ],
    });
    expect(text).toContain(`source="Tavily: "${query}""`);
    expect(text).toContain("Bun 2.0 is out.");
  });

  test("surfaces Tavily's own error message", async () => {
    stubFetch({ detail: { error: "This request exceeds your plan's set usage limit." } }, 432);
    const { text, details } = await run(TAVILY, { query: uniqueQuery("tavily 432") });
    expect(text).toBe("Error: Tavily API returned 432: This request exceeds your plan's set usage limit.");
    expect(details).toBeUndefined();
  });

  test("explains a status code when the body says nothing", async () => {
    stubFetch({}, 401);
    const { text } = await run(TAVILY, { query: uniqueQuery("tavily 401") });
    expect(text).toBe("Error: Tavily API returned 401: the API key is missing or invalid");
  });
});

// ---------------------------------------------------------------------------
// Filters on the other providers
// ---------------------------------------------------------------------------

describe("filters on Brave and SearXNG", () => {
  test("Brave maps time_range to freshness and domains to site: operators", async () => {
    const calls = stubFetch({ web: { results: [] } });
    const query = uniqueQuery("brave filters");
    await run(
      { provider: "brave", apiKey: "k" },
      { query, time_range: "week", include_domains: ["github.com", "gitlab.com"] },
    );
    expect(calls[0].url.searchParams.get("freshness")).toBe("pw");
    expect(calls[0].url.searchParams.get("q")).toBe(`${query} (site:github.com OR site:gitlab.com)`);
  });

  test("Brave sends no freshness or site filter by default", async () => {
    const calls = stubFetch({ web: { results: [] } });
    const query = uniqueQuery("brave plain");
    await run({ provider: "brave", apiKey: "k" }, { query });
    expect(calls[0].url.searchParams.has("freshness")).toBe(false);
    expect(calls[0].url.searchParams.get("q")).toBe(query);
  });

  test("SearXNG widens week to month, the nearest range it supports", async () => {
    const calls = stubFetch({
      results: [
        { title: "a", url: "https://a.test" },
        { title: "b", url: "https://b.test" },
      ],
    });
    const query = uniqueQuery("searxng filters");
    const { details } = await run(
      { provider: "searxng", searxngUrl: "http://localhost:8888" },
      { query, count: 1, time_range: "week", include_domains: ["github.com"] },
    );
    expect(calls[0].url.searchParams.get("time_range")).toBe("month");
    expect(calls[0].url.searchParams.get("q")).toBe(`${query} site:github.com`);
    expect(details?.results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

describe("cache", () => {
  test("a repeated search is served from cache, a different filter is not", async () => {
    const calls = stubFetch({ results: [{ title: "t", url: "https://t.test", content: "c" }] });
    const query = uniqueQuery("cache");

    await run(TAVILY, { query, time_range: "day" });
    const repeat = await run(TAVILY, { query, time_range: "day" });
    expect(calls).toHaveLength(1);
    expect(repeat.text).toContain("(cached)");
    expect(repeat.details?.provider).toBe("Tavily");

    await run(TAVILY, { query, time_range: "year" });
    await run(TAVILY, { query, include_domains: ["t.test"] });
    expect(calls).toHaveLength(3);
  });

  test("providers do not share cached results", async () => {
    const query = uniqueQuery("cache per provider");
    const tavilyCalls = stubFetch({ results: [] });
    await run(TAVILY, { query });
    expect(tavilyCalls).toHaveLength(1);

    const braveCalls = stubFetch({ web: { results: [] } });
    const { details } = await run({ provider: "brave", apiKey: "k" }, { query });
    expect(braveCalls).toHaveLength(1);
    expect(details?.provider).toBe("Brave Search");
  });
});
