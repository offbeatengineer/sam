// LLM calls for the exploratory scripts that need text written (index cards, synthetic notes).
// Same call shape as the production Haiku writer: the Agent SDK, no tools, no thinking,
// structured output.
export async function pool<T, R>(items: T[], size: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map((item, k) => fn(item, i + k)))));
  return out;
}

async function llmOnce(model: string, systemPrompt: string, prompt: string, schema: Record<string, unknown>): Promise<any> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const stream = query({
    prompt,
    options: {
      cwd: process.cwd(),
      model,
      systemPrompt,
      maxTurns: 2,
      tools: [],
      allowedTools: [],
      persistSession: false,
      settingSources: [],
      thinking: { type: "disabled" },
      outputFormat: { type: "json_schema", schema },
      env: { ...process.env },
      executable: "bun",
    },
  });
  let structured: unknown;
  let text = "";
  for await (const msg of stream as AsyncIterable<any>) {
    if (msg?.type !== "result") continue;
    if (msg.subtype !== "success") throw new Error(`${model} failed: ${msg.subtype}`);
    structured = msg.structured_output;
    text = typeof msg.result === "string" ? msg.result : "";
  }
  return structured ?? JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

/** A call now and then comes back with no structured output; generated data is not worth losing to that. */
export async function llm(model: string, systemPrompt: string, prompt: string, schema: Record<string, unknown>): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await llmOnce(model, systemPrompt, prompt, schema);
    } catch (err) {
      if (attempt === 3) throw err;
      console.log(`  ${model} attempt ${attempt} failed (${(err as Error).message}); retrying`);
    }
  }
}
