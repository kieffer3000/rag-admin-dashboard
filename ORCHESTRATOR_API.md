# answersDoc — Orchestrator API (`/api/v1`)

Single source of truth for building **external orchestrators** (e.g. a multi-expert
"room of experts" pipeline) on top of answersDoc's published **Answers Banks**.

- **Base URL:** `https://dash.answersdoc.com`
- **Two verbs:** `POST /api/v1/ask` (scoped Q&A) · `POST /api/v1/opine` (critique-on-artifact)
- **These endpoints are public** (NOT Clerk-gated). The **per-Bank API key is the credential.**
- **Design boundary:** the endpoints are **stateless** — each call is scoped by the key and
  remembers nothing between calls. Pipeline state (the "Story Bible" blackboard, stage
  ordering, critique loops) lives in the **orchestrator**, not here. Experts don't know
  they're in a pipeline; the orchestrator does.

---

## 1. Publishing a Bank → one key per expert

Each **Answers Bank** on the board is published (board → Connect dialog) into a
**Connection**. Publishing mints one secret key, **shown once**:

```
ad_live_<random>
```

The key resolves server-side to a **snapshot** of that Bank's wiring:
`{ namespace, source_ids[], answer_mode, model, speed, label }`.

- **One Bank ↔ one key.** N experts = N Banks = N keys.
- **Isolation:** retrieval is filtered to that Bank's wired sources
  (`filter: { source_id: { $in: source_ids } }`) inside one per-user Pinecone namespace.
  No cross-expert bleed — as long as a source isn't wired into two Banks.
- **`namespace` is derived server-side from the owner** — never trusted from the client. A
  key can only ever read/reason over its own Bank's corpus, read-only.
- **AUTO-SYNC: the snapshot follows the Bank — the KEY VALUE NEVER CHANGES.** Connections
  are linked to their Bank (board node). When the Bank's wired sources change — a file
  added or deleted, wired directly or via a box — the snapshot refreshes **automatically**
  (within a few seconds of the change, while the board is open): same bearer token, fresh
  `source_ids`. No env update or redeploy on the consumer side, no manual step.
  - **Legacy connections** (published before auto-sync) join on their first manual
    **↻ Re-sync** in the Connect dialog, which stamps the Bank link; from then on they
    follow automatically.
  - Auto-sync never shrinks a snapshot to EMPTY — emptying a key's corpus is a deliberate
    act (**Revoke**), not a side effect. Key rotation likewise: Revoke, then Publish fresh
    (Publish always mints a NEW key — don't use it to "refresh").
  - The sync runs from the owner's open board (write-time propagation). If sources are
    added and the board is closed before it settles (~3s), the next board visit syncs.
  - Traceability: if your pipeline stamps a `doctrineVersion`, bump it when you
    deliberately change doctrine sources, not on every auto-sync.

## 2. Auth

Send the key one of three ways (Bearer preferred for server-to-server):

```
Authorization: Bearer ad_live_...      # preferred
x-api-key: ad_live_...                  # alternative
{ "key": "ad_live_..." }               # in the JSON body (last resort)
```

- **Server-to-server (no `Origin` header): always allowed** — the key is the secret. This is
  the orchestrator path.
- **Browser (cross-origin):** the request `Origin` must be in the Connection's allowlist
  (set when publishing) or you get `403`. (Not relevant to a server orchestrator.)
- The embed widget uses a separate public `x-embed-id` slug — **do not use that for an
  orchestrator; use the secret key.**

## 3. Rate limit

`60 requests / minute / key` (best-effort, in-memory, per serverless instance — a courtesy
limit, not a hard boundary; the key scope is the real boundary). One video's pipeline
(~10–15 sequential expert calls) is well under this. For mass-parallel production through a
single key, add an orchestrator-side concurrency cap.

## 4. `POST /api/v1/ask` — scoped Q&A

Ask one expert a question, answered **only from its wired sources**.

**Request body:**
| field | type | notes |
|---|---|---|
| `question` | string | **required** |
| `conversation` | `[{role,content}]` | optional; last 30 turns used for follow-ups |
| `speed` | `'fast'\|'detailed'\|'research'` | optional; only honored if the publisher enabled speed choice, else the Bank's default |

**Response:** `{ "answer": string, "bank": string }`

- **Citation-free by design** — `/ask` never returns citations. Need cited sources
  (e.g. the Doctor stage)? Use `/opine` with `citations:"on"`.
- **`/ask` is bare, unsteered Q&A** — it does NOT accept `guides` or `references`. For
  anything that needs the doctrine injected — **including guided _writing_** — call
  **`/opine`** instead: it works with **no artifact** (just `instruction` + `guides`, over
  the Bank's wired sources). Reserve `/ask` for "answer from this Bank's corpus" with
  nothing to steer it.
- `409` if the Connection has no wired sources.

```bash
curl -sX POST https://dash.answersdoc.com/api/v1/ask \
  -H "Authorization: Bearer ad_live_KENNEDY" \
  -H "Content-Type: application/json" \
  -d '{"question":"What makes a hook pass the message-to-market match test?"}'
```

## 5. `POST /api/v1/opine` — critique-on-artifact

Have one expert **reason ABOUT an artifact you supply** (critique, rewrite, assess),
grounded in its wired sources and optionally steered by per-call doctrine.

**Request body:**
| field | type | notes |
|---|---|---|
| `instruction` | string | **required** — what to do (e.g. "Critique this hook, then rewrite it.") |
| `artifact` | `{ content?, url?, title? }` | the thing to opine on (the caller supplies it per call). `content` OR `url`; if only `url`, the server loads the page text. |
| `guides` | `string[]` | **doctrine / persona injected per call** — guaranteed in context (voice/priorities only; never invents facts). This is where the one-page doctrine rubric goes. |
| `references` | `[{content,title?}]` | optional exemplars ("make it like this"); ≤5, never cited |
| `grounding` | `'cited'\|'hybrid'` | `cited` = corpus-only; `hybrid` = may add general knowledge |
| `citations` | `'on'\|'off'` (or `include_citations: true`) | **default OFF.** ON → response adds a `citations[]` array + keeps `[n]` markers |
| `conversation` / `history` | `[{role,content}]` | optional; last 30 turns |

**Response:**
- Default: `{ "answer": string, "bank": string }` (citation-free)
- With `citations:"on"`: `{ "answer": string, "bank": string, "citations": [{ source_id, source_name, snippet, score }] }` (answer keeps `[n]` markers mapping to the array)

- `409` if the Bank has no wired sources **and** no artifact was supplied.

**Writing/assist call (clean prose, no citations):**
```bash
curl -sX POST https://dash.answersdoc.com/api/v1/opine \
  -H "Authorization: Bearer ad_live_KERN" -H "Content-Type: application/json" \
  -d '{"instruction":"Rewrite this hook in Kern's warm voice.",
       "artifact":{"content":"<hook text>","title":"Hook v1"},
       "guides":["<Kern one-page doctrine rubric>"]}'
```

**Doctor/critique call (sourced, actionable notes):**
```bash
curl -sX POST https://dash.answersdoc.com/api/v1/opine \
  -H "Authorization: Bearer ad_live_KENNEDY" -H "Content-Type: application/json" \
  -d '{"instruction":"Critique this hook against your doctrine. List concrete fixes.",
       "artifact":{"content":"<hook text>"},
       "guides":["<Kennedy one-page doctrine rubric>"],
       "citations":"on"}'
```

## 6. Errors

| status | meaning |
|---|---|
| `400` | missing `question` (ask) / `instruction` (opine) |
| `401` | missing / invalid / revoked key |
| `403` | key is domain-locked and the request `Origin` isn't allowed (browser only) |
| `409` | nothing to work over (no wired sources; opine also needs no artifact) |
| `429` | rate limit exceeded |
| `502` | upstream (Make / reasoning) temporarily unavailable |

## 7. Payload-size guidance (important)

In production, `/opine` **relays to a Make.com scenario**, and **Make's webhook payload
limit is the real constraint** — not the API. To stay well under it:

- **Scope each expert's artifact to its lane.** Send only what that expert needs — e.g.
  Headlines/Kennedy sees just the hook (tiny), Voice/Kern sees the VO lines, and only the
  structure expert (McKee) sees the full body. **Chunk a large body by act** and opine per
  chunk.
- Prefer many small, lane-scoped calls over one large blended one (this also preserves
  expert isolation and gives cleaner, per-lane notes to merge).
- `timeouts`: both endpoints allow up to ~300s server-side (reasoning/Research can run
  60–180s+). One-shot responses; no token streaming (poll stage completion instead).

## 8. Recommended "room of experts" pattern

1. Build one **Bank per expert** (wire its sources; optionally a Persona robot). Publish each
   → one key. Store keys **server-side** in the orchestrator (never client).
2. Keep the pipeline's shared state (the **Story Bible** blackboard) in the orchestrator.
3. **Writing stages:** call the expert's **`/opine`** (NOT `/ask`) with the doctrine in
   `guides`, **no artifact** (the wired sources suffice), and citations **off** (clean
   prose). `/ask` is only for bare, unsteered Q&A — it can't take `guides`.
4. **Doctor stage:** call each doctrine expert's `/opine` **separately** (no blending) with
   `citations:"on"`; **merge/dedupe** the notes orchestrator-side; loop write→critique→revise
   until notes are immaterial.
5. Stamp a `doctrineVersion` when you re-publish a Bank, for traceability.

> Ownership split: **answersDoc** owns the experts + the two verbs (ask/opine).
> The **orchestrator** owns per-lane artifact scoping, `doctrineVersion` stamping, the
> house-model choice, stage ordering, the blackboard, and the critique loop.

## 9. Doctrine-on-Bank (server-injected guides) — 2026-07-03

Each Bank can now carry a stored **doctrine** (its one-page judgment rubric), edited in-app via
the Bank's ⋮ menu → **Doctrine** (versioned, with a changelog and a "Refine against sources"
self-correction loop). When present, the doctrine is **injected server-side as the first
`guides[]` entry on every keyed call** — both `/ask` and `/opine`.

Implications for orchestrators:
- You may stop shipping the doctrine per-call. Callers that still send it are safe: an exact
  duplicate of the stored text is skipped (never injected twice). Note the dedupe is EXACT-match —
  if your per-call copy diverges from the stored version, BOTH will ride; migrate by clearing your
  per-call copy once the stored doctrine is authoritative.
- `/ask` now honours doctrine guidance too (previously bare Q&A): the doctrine wraps the
  generation prompt while retrieval still uses the raw question.
- Legacy connections without a `bank_node_id` stamp (never Re-synced) skip injection entirely.
