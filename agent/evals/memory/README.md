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
aliased ids, short Nouls); the guard row re-measured on 2026-09-18 with the paragraph cases:

| Judgment | Result |
| --- | --- |
| Recall, 58 situational memories, 1 request | 20/20 core, 2 irrelevant picks |
| Recall forced across 3 shards | 20/20 core, 4-5 irrelevant picks |
| Save gate | 18/18, no false forget requests |
| Knowledge gate (reply + tool calls, no tool results) | 12/12 (skip <= 1.06, save >= 1.96), 0 false saves |
| Reference-note guards (orders to the assistant, claims about the user) | 22/23, 0 hostile notes let through; the one false reject is a how-to phrased as a command (G02). The 8 paragraph notes, with the order or the claim about the user buried mid-paragraph, all judged right (hostile ones at 0.78-0.95 instruction / 0.91-0.93 about-user, benign ones at or below 0.06) |
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
bun run eval:memory:writer     # live note writer: one note per subject, English, revision, merge; a few cents
bun run eval:memory:smoke      # one question, checks the key and prints the model version
bun run eval:memory:recall     # A: automatic recall, 16 messages x 60 memories
bun run eval:memory:baseline   # A': same cases through Sam's current retriever (local, free)
bun run eval:memory:write      # B: save gate (18 messages) + C: invalidate/dedupe (10 statements)
bun run eval:memory:scale      # E: recall against 250 memories (60 real + 190 distractors)
bun run eval:memory:edge       # multi-turn context, Chinese input, standalone-span check
bun run eval:memory:cards      # F: progressive disclosure, route by subject card, then judge the memories inside
bun run eval:memory:notes      # G: the same for reference notes: note cards, then folders (--folders)
bun run eval:memory:grow       # H: folders grown one note at a time instead of grouped in one pass (--read)
bun run eval:memory:facts      # I: listing cards for user facts, and fact trees grown one at a time or in batches
bun run eval:memory:filer      # live: the production filer grows both trees from the fixture streams, then recall through them
```

A full pass costs well under $0.05. `baseline` loads `@huggingface/transformers` from
`~/.sam/deps` and the model from `~/.sam/models`, so the agent must have run once with
memory enabled. Raw answers are dumped to `results/` (gitignored).

## Files

| File | What it is |
| --- | --- |
| `run.ts`, `floors.json` | The regression harness above and its pass/fail bounds |
| `writer.ts` | The production note writer (Haiku or the `memory.writer` model) on the knowledge cases: note count, length, language, a revision, a merge. Not floored: model output varies |
| `typesafe.ts` | `ask()` for the exploratory scripts, backed by the production client |
| `data.ts` | 60 memories plus labeled recall / save / update / forget / instruction / profile / duplicate cases |
| `recall.ts` | One request per message: a Noul per memory, a Choice over all ids, a gate Noul |
| `baseline.ts` | mxbai-embed-xsmall-v1 (q8), cosine top-5, raw user message as the query |
| `save_update.ts` | Save gate (Nouls + one Score) and per-memory relation Choice against the store |
| `scale.ts` | Single Choice vs. 250 short Nouls on a 250-memory store |
| `distractors.ts` | The 250-memory store (60 real + 190 templated distractors) shared by `scale.ts` and `cards.ts` |
| `notes.ts` | 80 synthetic reference notes in 16 themes, 144 generated queries (headline / buried detail, subject named / buried detail, subject not named; half Chinese): note cards in four variants, folder cards as a title listing or an LLM summary, against flat full-text recall |
| `grow.ts` | The notes.ts store plus 24 notes that sit between two themes, filed one at a time by Jev (Choice or Nouls over folder listings) in three arrival orders, with and without split-on-overflow; tree quality against the themes, and recall through the grown trees |
| `facts.ts` | The cards.ts store again, with the subject card replaced by a listing of the facts themselves; fact trees filed one at a time by Jev or in batches by Haiku; a domain level that lists subject names |
| `filer.ts` | The production filer and writer prompts over the fixture memories arriving one at a time, then the production recaller through the trees they grew. Not floored: the filing model's output varies |
| `fixtures/` | What the models generated for cards.ts, notes.ts, grow.ts and facts.ts: index cards, notes, queries, grown trees. Committed because a rerun of the generators gives different data and the numbers below are about these. `--fresh` rebuilds them |
| `llm.ts` | The Agent SDK call the scripts use when they need text written (cards, synthetic notes) |
| `cards.ts` | Subject and domain index cards written by an LLM that never sees the cases; hop-1 routing with ablations, two- and three-hop recall against flat recall, a write-time coverage check |
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

## Progressive disclosure (2026-09-18, `jev-1.13.0`)

`cards.ts` asks whether recall can stop judging every memory: file memories under
`domain/subject` paths, give each subject an index card (`Holds:` and `Matters when:`), let
Jev pick subjects from the cards alone, and judge only the memories inside. 248 memories,
33 subjects, 11 domains; the 16 recall cases plus 9 new ones whose core memory sits in a
subject the message does not name (30 core memories). Paths came from Sonnet and cards from
Haiku, both blind to the cases.

| | Core | Noise | Tokens / turn |
| --- | --- | --- | --- |
| Flat (production) | 30/30 | 11-12 | 13,961 |
| Two-hop, subject cards v1, open at 0.5 | 29/30 | 1 | 4,442 |
| Two-hop, subject cards v2, open at 0.5 | 30/30 | 2 | 4,442 |
| Three-hop via domain cards, v1 / v2 | 29/30 / 28-30/30 | 3 | ~3,570 |

- No miss came from Jev failing to make an implicit link from a card (dessert -> lactose
  intolerant, NVDA calls -> index funds only, an 8:30 call -> no meetings before 10 all routed
  at p >= 0.69). Every miss was a card that did not cover what was filed under it.
- v1's miss: the upcoming Hokkaido trip filed with 30 past trips, whose card read "extensive
  travel history". The three lowest core p in v1 (0.16, 0.54, 0.63) were all that one card.
  v2 adds one general rule (lead with anything upcoming, time-bound or constraining) on the
  same grouping: 30/30, lowest core p 0.69. v2 was written after seeing the miss.
- Domain cards are the fragile layer: a summary of summaries, and it moves between writer
  runs. v2's sam-project card dropped staging and the Rust decision, and two DIRECT questions
  missed at 0.20 and 0.22. Stay flat over subject cards as long as they fit (a card with its
  Noul is ~114 tokens, so ~200 per request).
- `Matters when:` is a safety net, not the mechanism: holds-only loses 1 of 30 (a card whose
  `Holds:` was cut at 160 chars), at ~30% fewer tokens. Path-only collapses at 0.5 (22/30,
  answers pile up at 0.4-0.5) but is 30/30 at 0.15 with ~8 subjects opened.
- No card opened for the four "nothing relevant" cases. Opened per case: 1.5 at 0.5, 2.6 at 0.3.
- Latency: each request ~350 ms, so two hops are ~0.7 s against 0.45-0.9 s flat across runs.
- Hop 1 is 3.8K of the 4.4K tokens: cost follows the number of subjects, not memories.
- `--coverage` (does the card cover each memory filed under it?) puts the at-risk memories
  at the bottom of the ranking (v1, "expects" wording: M41 0.10, M18 0.20, M21 0.22), but it
  is not usable yet: that wording also flags 68/248, mostly bulk items, and the lenient one
  leaves M18 at 0.68.

Not tested: building the paths incrementally (here one global pass), reference notes, and a
store whose distractors do not fall into seven tidy subjects.

### Reference notes (`notes.ts`)

Notes are what grows, and today each one goes to Jev in full every turn: 80 notes averaging
1,137 chars cost 24,403 tokens a turn, ~305 per note with its Noul. 143 of 144 generated
queries are recalled flat; the rest is measured on those 143.

| | Target recalled | Notes reaching the model | Tokens / turn | Median |
| --- | --- | --- | --- | --- |
| Flat (production) | 143/143 | 1.9 | 24,403 | 512 ms |
| Note cards: title + details, open at 0.3, then full text | 143/143 | 1.5 | 13,703 | 850 ms |
| Note cards: title + tags only, open at 0.15 (4.6 opened) | 143/143 | n/a | ~7,200 est. | n/a |
| Folder listing, open at 0.15, then full text of the folder | 143/143 | 1.5 | 3,968 | 715 ms |
| Folder summary (Haiku), open at 0.3, then full text | 143/143 | 1.5 | 4,060 | 743 ms |
| Folder listing, then note cards, then full text | 141-142/143 | 1.5 | ~3,950 | 1,090 ms |

- A card per note buys little. A note is ~305 tokens; a card good enough for full recall
  (title + a `Details:` line of the names, numbers and error strings in the note) is ~150, so
  the saving is 2x for an extra round trip. The full card (holds + matters-when + details) is
  ~235 tokens, barely smaller than the note. The 10x guessed for "judge the summary, inject the
  text" does not hold at this note length.
- Buried details are where note cards miss: at 0.5, headline 47/47 for every variant, but
  detail-with-subject-named 40/48 (title) to 48/48 (title + details) and detail-with-subject-not-
  named 34/48 (title) to 44/48. Lower thresholds recover all of them; nothing was judged wrong,
  only uncertain. Title + tags is free (the writer already produces both) and reaches 143/143
  at 0.15 with 4.6 notes opened.
- The folder is what cuts cost: 16 folder cards are 2,031 tokens, a query opens 1.0-1.2
  folders, and reading those 5-6 notes in full is ~1,900 more. 6x fewer tokens than flat, fewer
  irrelevant notes (1.5 vs 1.9), one extra round trip.
- A folder card can be the directory listing, the folder name and the titles inside, with no
  LLM-written text: nothing to go stale, no writer variance (the weak point of the domain cards
  above). It misses one implicit query at 0.3 (0.29: an S3 request bill -> LanceDB compaction)
  and none at 0.15. The Haiku summary does no better end to end.
- Note cards between folder and full text only lose targets and add a hop.
- Chinese queries route as well as English ones (68-71/71 vs 66-67/72 at 0.5).

The folder result is optimistic: the 16 themes are separate islands, and grouping by title
recovered them exactly, so every query had one obvious folder. Not tested: overlapping topics,
folders larger than 5, folders built incrementally, more than one run.

### Growing the folders (`grow.ts`)

The folders above came from one model grouping every title at once. A real store files one
note at a time. 104 notes (the 80, plus 24 "bridge" notes that belong to two themes), 211
queries that flat recall answers. Each arriving note goes to Jev with the current folders as
listings; it joins the best folder or gets a new one, named by Haiku.

Judged against the themes, the grown trees are bad, and how they are bad depends on the
arrival order:

| Tree (rule / note shown as / order) | Folders | Largest | Singletons | Notes in a folder of another theme |
| --- | --- | --- | --- | --- |
| Global grouping (reference) | 16 | 10 | 0 | 0 |
| noul / title / shuffle-1 | 19 | 20 | 5 | 22 |
| noul / title / shuffle-2 | 47 | 11 | 33 | 6 |
| choice / title / bridges-first | 34 | 29 | 21 | 21 |
| the same three with a cap of 8 | 37-42 | 8 | 17-23 | 1-4 |
| filed 4 at a time by Haiku seeing every listing, cap 8 (three orders) | 21-25 | 8 | 1-5 | 0-3 |

- Snowball: a bridge note ("Traveling with a corgi in a Model 3") joins the Tesla folder, the
  next corgi note sees a similar title inside and follows at 0.71, and the rest pour in at
  0.8-0.9. `ev-charging-setup/` ends up with 14 notes, `ubuntu-security/` with 20 (LanceDB,
  Bun and Hetzner). Membership judged against the members is single-linkage clustering, and
  the folder keeps the name its first note gave it.
- Fragmentation: the first note names the folder narrowly (`japan-rail-passes`,
  `jlpt-registration`) and later siblings do not fit. One theme ends up in five folders.
- Choice or Nouls, title or full text: no consistent difference. Every one of the 12 trees
  has both problems.

And yet recall through them is the same as through the reference tree:

| Tree | Target recalled | Folders opened | Notes read in full | Tokens / turn |
| --- | --- | --- | --- | --- |
| Flat (production) | 211/211 | - | 104 | 33,173 |
| Global grouping (reference) | 211/211 | 2.7 | 18.9 | 8,404 |
| Grown, no cap (three trees) | 211/211 | 2.5-5.2 | 14.4-20.5 | 8,755-9,169 |
| Grown, cap 8 (three trees) | 211/211 | 4.1-5.2 | 14.3-17.4 | 8,463-9,276 |
| Grown, with links to second folders | 211/211 | 2.9-5.4 | 15.4-23.6 | 9,126-10,124 |
| Filed 4 at a time by Haiku, cap 8 (three trees) | 211/211 | 3.0-3.8 | 16.3-20.4 | 7,826-9,122 |

- A folder's card is the listing of its titles, so filing a note in the wrong folder cannot
  hide it: the corgi note under `ev-charging-setup/` still shows its title there. The tree is
  a way to batch titles and share one question among them. Any partition recalls; a topical
  one reads fewer notes. This would not hold for LLM-written summary cards.
- Split-on-overflow (a folder past 8 notes is split by Haiku, which sees all its titles) pulls
  the mixed folders apart (`tesla-shanghai-charger(9)` -> Tesla 3 + corgi 6), bounds what one
  opened folder can cost, and loses nothing. It does not merge singletons; that would need a
  periodic pass, and only to save tokens.
- Filing in small batches by a model that sees every folder listing gives the tidiest trees
  (21-25 folders, 1-5 singletons, at most 3 notes in a folder of another theme) and the same
  recall. The notes not yet filed wait in an inbox that every recall has to read in full, which
  is why the batch is 4 and not 12 as for facts.
- Links (a note also listed in a second folder it fits) recall nothing extra and cost 5-12%
  more tokens.
- The saving is 3.6-3.9x here against 6x on the 80 tidy notes: with overlapping topics a query
  opens 2.7 folders instead of 1.2 and reads ~19 notes instead of 6, so the full-text hop is now
  about two thirds of the cost. The 0.15 threshold is the knob.

Four generated queries were dropped as not being user messages (a statement, and descriptions
such as "User is asking about..."); two of them sat at p 0.48 in the full-text step and flipped
between runs. Not tested: a store large enough that the cap matters for cost, merging
singletons, user facts (no titles to list), more than one run per tree.

### Listing cards for user facts (`facts.ts`)

The same idea on the cards.ts store (248 memories, 25 cases, 30 core): the subject card is the
facts themselves, `food-preferences/ holds 4 memories: User is vegetarian. | ...`, one Noul per
subject, then the production recall on the facts in the opened subjects.

| Tree | Folders | Core | Noise | Tokens / turn (open at 0.5) |
| --- | --- | --- | --- | --- |
| Flat (production) | - | 30/30 | 11-12 | 13,961 |
| LLM-written cards v2, grouped in one pass | 33 | 30/30 | 2 | 4,442 |
| Listing cards, grouped in one pass | 33 | 30/30 | 2 | 7,018 |
| Listing cards, filed one fact at a time by a Jev Choice (cap 8 / 16) | 115-143 | 30/30 | 1-4 | 10,831-12,250 |
| Listing cards, filed 12 at a time by Haiku seeing every folder (cap 16) | 38-39 | 30/30 | 4-5 | 7,186-7,380 |
| Domain listing -> subject listings -> facts, open at 0.15 | 11 / 33 | 30/30 | - | 4,857 (3 hops, 1.06 s) |

- Recall never moved: 30/30 for every tree at 0.5, 0.3 and 0.15. As with notes, a listing
  cannot hide what is filed under it, however badly it is filed.
- Cost is another matter. A fact is ~18 tokens and its Noul ~38, so the listing saves by sharing
  one question among many facts. Filed one at a time, facts shatter: 58-91 of the folders hold a
  single fact ("typescript-preference", "bun-preference", "knee-injury"), each pays for its own
  question, and the turn costs 78-88% of flat. The namer sees one fact and cannot know how broad
  the subject will turn out to be.
- Filing in batches fixes that: the facts wait in an inbox, and a model that sees every folder
  files 12 at once. It can put two new facts on one new subject together. 38-39 folders, 4-5
  singletons, the same cost as the one-pass grouping. The inbox has to be read by every recall
  until it is filed (12 facts are ~670 tokens).
- Listing cards cost more than LLM summaries here (7.0K vs 4.4K) because the 30-item distractor
  subjects are listed in full where a summary says "30 colleagues". What the listing buys is
  that nothing depends on a writer's summary being complete or current.
- Each one-at-a-time filing sent the whole tree to Jev: ~4,500 tokens at 248 facts, and linear
  in the store.

### In production (`src/memory/recaller.ts`, `filer.ts`)

What the experiments above settled is implemented: `planRecall`, the listings and the two
folder questions live in `judgments.ts`, and the exploratory scripts now import them. The
regression harness runs the production recaller through two of the grown fixture trees
(`tree_facts.*`, `tree_notes.*` in `floors.json`), with recall floored and tokens per turn
capped, since filing quality can only move cost. Measured 2026-09-19 with `jev-1.13.0`:

| | Recall | Tokens / turn | Flat |
| --- | --- | --- | --- |
| `eval:memory:all`, facts through `batched-1/cap16` | 30/30 core, noise 3 | 7,460 | 13,961 |
| `eval:memory:all`, notes through `batched/title/shuffle-2/cap8` (every 4th query) | 53/53 | 8,058 | 33,173 |
| `eval:memory:filer`, facts filed by the production filer (Haiku): 41 folders, 7 of one, 8 unfiled | 30/30 core, noise 4 | 8,278 | 13,961 |
| `eval:memory:filer`, notes filed by the production filer: 20 folders, 2 of one | 53/53 | 8,551 | 33,173 |

Two things differ from the experiments. Each routed track sends its own folder request, in
parallel, as measured (one combined request was never tried). And a folder with no answer
is opened rather than skipped.

Caveats: small test set, authored together with the memories, templated distractors, and
the save threshold was chosen after seeing the scores. Request limits: ~32K tokens shared by
state and questions, 255 options per Choice, 10 levels per Score.
