/**
 * App build number — displayed at the bottom of the olive rail.
 *
 * BUMP RULES (user directive 2026-07-05):
 *   +0.1 — every shipped change set (bug fix, feature, tuning)
 *   +1.0 — major reconstructions
 * Baseline: 3.5 declared 2026-07-05.
 * 3.6 — 2026-07-05: stack privacy (engine aliases, guardrail on every answer path), top-right stamp removed, manual refreshed.
 * 3.7 — 2026-07-05: villain decoy codenames over the wire; real ids resolve server-side only (model-map.server.ts).
 * 3.8 — 2026-07-05: project switcher capped (~8 visible, scroll to 13, View all beyond).
 * 3.9 — 2026-07-05: Olive Grove beauty pass (warm tokens, layered shadows, sunlit rail, olive dot grid, jewel zoom controls) + answersDoc wordmark under the top-right menu.
 * 3.10 — 2026-07-05: connected agents — board robot edits write through to the Agents page and back; copies on the board stay in sync.
 * 3.11 — 2026-07-06: ni@tiosquare.com added to the access allowlist + invited via Clerk.
 * 3.12 — 2026-07-06: unixtech7@gmail.com added to the access allowlist + invited via Clerk.
 * 3.13 — 2026-07-06: model picker + all engine-name displays removed from the UI (selection not exposed yet).
 * 3.14 — 2026-07-06: local-first PDFs — the browser reads the text layer (pdf.js), auto-splits, and indexes parts under ONE source; converter only for true scans.
 * 3.15 — 2026-07-06: upload rows show size · detected pages · live phase + conservative ETA under the filename.
 * 3.16 — 2026-07-06: exact-mention lexical lane — "is X mentioned" / quoted / proper-noun questions get an exhaustive literal scan of the wired sources injected beside semantic retrieval (the Kathy fix).
 * 3.17 — 2026-07-06: metering + abuse layer — plan caps (questions/month gate on query+opine, live storage gate at ingest), usage_counters table, managed spend-capped OpenRouter sub-keys for non-BYOK scopes, public embed/API per-IP throttle + durable per-connection daily budget.
 */
export const BUILD_VERSION = '3.17';
