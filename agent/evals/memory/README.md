# Memory evals: TypeSafe (Jev) vs. embedding recall

Two things live here:

- **`run.ts`, the regression harness** for Sam's automatic memory. It runs the production
  question builders and deciders from `src/memory/judgments.ts` against the labeled data
  and fails when a metric drops below `floors.json`.
- **The exploratory scripts** from the feasibility study that led to automatic memory
  (`recall.ts`, `save_update.ts`, `scale.ts`, `edge.ts`, `baseline.ts`). They use their own
  early question wording and are kept as the record of how the design was chosen.

## Regression harness

```sh
bun run eval:memory:all     # from agent/; needs TYPESAFE_API_KEY, costs about a cent
bun run test                # offline unit tests for sharding, aliasing, and the deciders
```

Run the harness before changing a question's wording, a threshold, or the pinned Jev
model (`DEFAULT_JEV_MODEL`). It warns when the served model differs from the one the
floors were calibrated on. Floors sit one or two cases below the measured result because
answers near 0.5 flip between runs; the zero-tolerance ones are the costly mistakes:
superseding a memory that is not outdated, storing an instruction, forgetting something
the user did not ask to forget.

Measured on 2026-09-17 with `jev-1.13.0`, in the production form (`conversation` state,
aliased ids, short Nouls):

| Judgment | Result |
| --- | --- |
| Recall, 58 situational memories, 1 request | 20/20 core, 2 irrelevant picks |
| Recall forced across 3 shards | 20/20 core, 4-5 irrelevant picks |
| Save gate | 18/18, no false forget requests |
| Outdated memories superseded | 5/7, 0 wrong supersedes, 0/11 traps |
| Restatements caught as duplicates | 5/5 |
| Instruction-shaped facts rejected | 8/8 (0 missed) |
| Profile-scope | 7/7 |
| Forget requests | 7/7, nothing wrongly forgotten |

The two update misses are both conservative. U06 is the compound memory ("checkup every
six months; last visit in March"). U09 ("We re-enabled pulse") is judged outdated at a
confidence below `supersedeConfidence`, so the new fact is saved and the old one is
flagged for review instead of being replaced.

One borderline seen while testing: "User does not eat meat." against "User is vegetarian."
comes back `consistent` (0.62) rather than `duplicate` (0.38), so both get stored. That is
a defensible reading, and the thresholds were deliberately not tuned to one example.

## Feasibility study

All data in `data.ts` is **synthetic**. Do not point these scripts at a real memory store:
every request sends the whole store to TypeSafe, and no data-retention policy was found
when this was written (2026-09-17).

## Run

Needs `TYPESAFE_API_KEY` in `agent/.env`. From `agent/`:

```sh
bun run eval:memory:smoke      # one question, checks the key and prints the model version
bun run eval:memory:recall     # A: automatic recall, 16 messages x 60 memories
bun run eval:memory:baseline   # A': same cases through Sam's current retriever (local, free)
bun run eval:memory:write      # B: save gate (18 messages) + C: invalidate/dedupe (10 statements)
bun run eval:memory:scale      # E: recall against 250 memories (60 real + 190 distractors)
bun run eval:memory:edge       # multi-turn context, Chinese input, standalone-span check
```

A full pass costs well under $0.05. `baseline` loads `@huggingface/transformers` from
`~/.sam/deps` and the model from `~/.sam/models`, so the agent must have run once with
memory enabled. Raw answers are dumped to `results/` (gitignored).

## Files

| File | What it is |
| --- | --- |
| `run.ts`, `floors.json` | The regression harness above and its pass/fail bounds |
| `typesafe.ts` | `ask()` for the exploratory scripts, backed by the production client |
| `data.ts` | 60 memories plus labeled recall / save / update / forget / instruction / profile / duplicate cases |
| `recall.ts` | One request per message: a Noul per memory, a Choice over all ids, a gate Noul |
| `baseline.ts` | mxbai-embed-xsmall-v1 (q8), cosine top-5, raw user message as the query |
| `save_update.ts` | Save gate (Nouls + one Score) and per-memory relation Choice against the store |
| `scale.ts` | Single Choice vs. 250 short Nouls on a 250-memory store |
| `edge.ts` | `conversation` state, cross-lingual recall, "is this span standalone?" |

## Recorded results (2026-09-17, `jev-1.13.0`)

| Judgment | Jev | Embedding top-5 |
| --- | --- | --- |
| Recall, 60 memories | 20/20 core, 4/68 picks irrelevant | 16/20 core, 54/80 slots irrelevant |
| Recall, 250 memories | 20/20 core, 3/59 picks irrelevant | not run |
| Save gate, 18 messages | 18/18 with one 3-level Score (skip <= 0.93, save >= 1.70) | n/a |
| Invalidate, 10 statements | 6/7 outdated found, 0/11 traps, 2 low-confidence false flags | n/a |
| Latency / cost per turn | ~320 ms, $0.0003 (60) / ~585 ms, $0.0006 (250) | ~1 ms, free |

Findings worth keeping in mind when building on this:

- Embeddings are the wrong stage-1 prefilter: "User is vegetarian" ranked #34 of 60 for a
  dinner request, and no cosine threshold separates "nothing relevant" (top-1 0.22-0.26)
  from implicit hits (0.23-0.24). Shard the store across parallel requests instead.
- Use independent per-memory Nouls for multi-label recall. A Choice sums to 1, so it is a
  ranking, not a relevance test. Short Nouls without criteria were cheaper and cleaner.
- Style preferences (M13, M14) fire on nearly every turn. They belong in an always-on
  profile, not in per-turn recall.
- The one invalidation miss was a compound memory (M16 holds two facts). Keep memories atomic.
- Both false "outdated" flags had confidence near 0.4. Gate destructive actions on
  confidence and supersede rather than hard-delete.
- Jev cannot write memory text. It only gates and selects; an LLM still authors the memory.

Answers near 0.5 flip between runs. A second run the same day gave 3/67 irrelevant recall
picks (was 4/68) and 3 false "outdated" flags (was 2). Every false flag so far comes from
U01 ("I moved to Berlin"), where Jev marks implied consequences such as the Shanghai
half-marathon training (M11), the RMB dining budget (M19) and the home office (M29), each
at low confidence. Core recall, the save gate and the trap count were identical.

Caveats: small test set, authored together with the memories, templated distractors, and
the save threshold was chosen after seeing the scores. Request limits: ~32K tokens shared by
state and questions, 255 options per Choice, 10 levels per Score.
