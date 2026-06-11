# answersDoc Board — Canvas Spec

The Board is a **visual `source_ids[]` assembler** over the frozen RAG backend
(Make.com Indexing scenario 4711858 + Query scenario 4776452). Connectivity IS
scope: whatever is wired to a Brain node becomes that chat's retrieval basis.
Nothing about the webhooks, the `{answer, citations[]}` response shape, or
metadata schema v2 changes — only how the id-list is assembled (graph edges
instead of checkboxes).

## Locked decisions (2026-06-11)
- **Mode:** Board = flagship; existing Chat/Library stays as "Classic" toggle.
- **Grouping:** magnetic **typed hubs** — user-created & named; a hub accepts
  ONE media type; chips dock by proximity (snap), no bulky bounding boxes.
- **Text node → brain:** ephemeral prompt context. NEVER indexed.
- **Empty brain default:** one-click **Everything hub** (all indexed project
  sources). The Brain composer can also upload docs that DO get indexed
  (persistent ingest — distinct from the ephemeral text node).
- **Boards:** many boards per project (default'd; confirm with user).

## Node types
| type | data | role |
|---|---|---|
| `chip` | `{ mediaId }` | one indexed source (puzzle piece) |
| `hub` | `{ name, mediaType }` | magnetic same-type container; members = chips with `parentId === hub.id` |
| `hub` (everything) | `{ mediaType: 'everything' }` | implicit: ALL indexed project sources |
| `brain` | `{ name }` | chat node; target of all edges; runs the query |
| `textNode` | `{ text }` | ephemeral prompt context |
| `annotation` | `{ text }` | sticky note, never wired |

## Edge semantics
- `chip → brain`: include that source's id.
- `hub → brain`: include every docked chip's id (everything-hub → all indexed
  project ids).
- `textNode → brain`: append prose to the prompt (ephemeral).
- Only edges INTO a brain are valid (`isValidConnection`).
- Unlink (select edge + ⌫) ⇒ out of scope.

## Scope assembler
For brain B: walk inbound edges → collect mediaIds (direct chips + hub members,
dedupe, indexed only) + context texts. POST `{ question, source_ids, namespace }`
to the Query webhook via `app/api/query` (server-side URL). Render
`{ answer, citations[] }` with simulated streaming; filter null citations
(`citations.filter(c => c.source_id)`).

## Magnetic docking
- Drag chip; intersecting same-type hub glows; on drop → chip reparented
  (`parentId`, relative position, appended after parent in array), members
  re-tiled into a compact 2-col grid (no wasted canvas).
- Cross-type hubs reject (no glow, no dock).
- Drag chip out of hub bounds → undock (back to absolute position).
- Moving the hub moves all docked chips (parent/child).

## Ingestion (P4)
Floating left toolbar (Poppy-style): per-type buttons → mini input → POST
`app/api/index` → Indexing webhook → chip appears `processing` → `indexed`.
Brain composer attach = same path. Until P4 the toolbar uses the mock store.

## File map
- `lib/rag/board/types.ts` — node/edge data types + constants
- `lib/rag/board/store.tsx` — `BoardProvider`: per-project boards, brain
  messages, scope assembler
- `components/rag/board/` — `board-canvas.tsx`, `chip-node.tsx`, `hub-node.tsx`,
  `brain-node.tsx`, `text-node.tsx`, `annotation-node.tsx`, `toolbar.tsx`
- `app/(dashboard)/board/page.tsx` — route (nav: Board first; Classic kept)

## Frozen invariants (do not touch)
Indexing + Query webhook contracts · `{answer, citations[]}` · metadata schema
v2 (`agent_files/rag/projects/answersdoc_metadata_schema.md` in life_agents) ·
Neon table design (WIRING_SPEC.md) · scope logic lives client-side.
