// Baseline: what Sam's current retriever (mxbai-embed-xsmall-v1, q8, cosine top-5) returns
// if the raw user message were used as the query for automatic per-turn recall.
import { homedir } from "node:os";
import { MEMORIES, RECALL } from "./data";

const transformers: any = await import(`${homedir()}/.sam/deps/node_modules/@huggingface/transformers`);
transformers.env.cacheDir = `${homedir()}/.sam/models`;
const extractor = await transformers.pipeline("feature-extraction", "mixedbread-ai/mxbai-embed-xsmall-v1", { dtype: "q8" });
const embed = async (t: string) => Array.from((await extractor(t, { pooling: "mean", normalize: true })).data as Float32Array);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

const ids = Object.keys(MEMORIES);
const mem = await Promise.all(ids.map(async (id) => ({ id, v: await embed(MEMORIES[id]) })));

const K = 5;
let coreHit = 0, coreTotal = 0, noise = 0, total = 0;
const topScoreByKind: Record<string, number[]> = {};
for (const c of RECALL) {
  const t0 = performance.now();
  const qv = await embed(c.msg);
  const ranked = mem.map((m) => ({ id: m.id, s: dot(qv, m.v) })).sort((a, b) => b.s - a.s);
  const ms = performance.now() - t0;
  const top = ranked.slice(0, K);
  const allowed = new Set([...c.core, ...c.ok, "M13", "M14"]);
  const hit = c.core.filter((id) => top.some((t) => t.id === id));
  const extra = top.filter((t) => !allowed.has(t.id));
  coreHit += hit.length; coreTotal += c.core.length; noise += extra.length; total += K;
  (topScoreByKind[c.kind] ??= []).push(top[0].s);
  const rankOf = (id: string) => ranked.findIndex((r) => r.id === id) + 1;
  console.log(`${c.id} [${c.kind}] "${c.msg.slice(0, 60)}"`);
  console.log(`  top${K}: ${top.map((t) => `${t.id}(${t.s.toFixed(2)})`).join(" ")}   ${ms.toFixed(0)}ms`);
  console.log(`  core ${hit.length}/${c.core.length}  ranks: ${c.core.map((id) => `${id}#${rankOf(id)}`).join(" ") || "-"}   noise: ${extra.map((e) => e.id).join(" ") || "-"}`);
}
console.log(`\n== embedding top-${K}: core recall ${coreHit}/${coreTotal}, noise ${noise}/${total} slots`);
for (const [k, v] of Object.entries(topScoreByKind)) console.log(`   top-1 cosine for ${k}: ${v.map((x) => x.toFixed(2)).join(", ")}`);
