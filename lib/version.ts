/**
 * App build number — displayed at the bottom of the olive rail.
 *
 * BUMP RULES (user directive 2026-07-05):
 *   +0.1 — every shipped change set (bug fix, feature, tuning)
 *   +1.0 — major reconstructions
 * Baseline: 3.5 declared 2026-07-05.
 * 3.6 — 2026-07-05: stack privacy (engine aliases, guardrail on every answer path), top-right stamp removed, manual refreshed.
 * 3.7 — 2026-07-05: villain decoy codenames over the wire; real ids resolve server-side only (model-map.server.ts).
 */
export const BUILD_VERSION = '3.7';
