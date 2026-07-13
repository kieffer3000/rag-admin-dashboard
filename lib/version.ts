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
 * 3.18 — 2026-07-06: Health page shows "This month" usage meters (questions vs cap, documents added, storage vs cap, plan badge); vendor name scrubbed from the Health header (stack privacy).
 * 3.19 — 2026-07-06: Health split into Admin/User views (owner toggle previews exactly what a user sees); index-wide totals now owner-only in /api/usage (were in every response); "Namespaces · one per project" card corrected to "Projects · all in your private space".
 * 3.20 — 2026-07-06: white brand mark sits directly on the olive rail (no tile box, Make.com-style); rail project-switcher tile keeps a fixed olive-glass look in both themes.
 * 3.21 — 2026-07-06: Health page scrolls as one column — the grown header (This-month + admin table) was crushing the per-source list's scroll area to zero height.
 * 3.22 — 2026-07-06: Health per-source list shows ALL projects, grouped (active project live + manageable, others read-only snapshots); Sources card counts every project.
 * 3.23 — 2026-07-06: Health organization — sortable sources (name/chunks/size/indexed, click to flip), collapsible project groups (persisted; first visit opens only the current project), search box, per-group chunk/size totals, expand/collapse all.
 * 3.24 — 2026-07-06: pricing plans wired — starter/pro/team caps from the researched cost model (80-90% margin), question CREDITS (ask 1 / research 3 / opine 2), BYOK doubles the allowance, monthly upload gate, starter plan slug.
 * 3.25 — 2026-07-06: managed LLM caps resized to cover FULL credit burn + headroom (starter $2 / pro $8 / team $48) — the credit gate is the limiter customers feel; the dollar cap is only the emergency brake.
 * 3.26 — 2026-07-06: caps re-derived at the WORST legitimate mix (all-research, ~$0.023/credit): starter $3 / pro $13 / team $75 — the internal dollar brake can never bind a legitimate month.
 * 3.27 — 2026-07-06: overage top-up packs — `topup_questions` counter adds to the monthly allowance at both question gates; owner-only /api/admin/grant-credits grants packs ($10/100, $39/500); storage marketed in PAGES (~10 vectors/page measured).
 * 3.28 — 2026-07-06: figure billing design pinned — a figure = 2 pages of storage, 50 figures = 1 upload credit (constants in plans.ts; extraction feature itself queued).
 * 3.29 — 2026-07-06: 📋 Forms — smart form filling: fillable PDF's fields read in-browser (pdf-lib, the PDF never leaves the tab), answered from wired sources via /api/fill-form (one batched JSON generation, 3 credits), values written back locally with per-field evidence + editable review.
 * 3.30 — 2026-07-10: walkthrough UX pass — desktop top bar removed (controls live at the rail's bottom, wordmark under the logo); rail is ONE flat dark olive with pure-white labels + technical aliases (RAG/prompts/artifacts…) and tooltips; Library/Projects rows are single dense lines (the "source ↗" link that hijacked clicks to a parked domain is gone); Agents cards edit on text-click; Forms steps sit side-by-side; highlight-to-copy everywhere (SelectCopy).
 * 3.31 — 2026-07-13: click-to-add bank pills — clicking a bank's pill opens a popup that adds + WIRES content straight into that lane: Library → upload sources (one loose chip if single, a box if several), Draft → upload/paste one working doc → artifact, Examples → add a sample → reference, Persona → pick a saved agent → robot. New pillAdd store signal + board-canvas host; UploadDialog gained onSourcesAdded; new AgentPickDialog.
 */
export const BUILD_VERSION = '3.31';
