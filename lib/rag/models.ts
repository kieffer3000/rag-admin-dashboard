export type LlmProvider = 'claude' | 'gemini';

export interface LlmModel {
  id: string;
  label: string;
  short: string;
  provider: LlmProvider;
  blurb: string;
}

/**
 * STACK PRIVACY (user directive 2026-07-05): user-facing names are DECOY
 * villain codenames — competitors can't reverse-engineer the stack from the
 * UI, the bundle, OR the network tab. These `id`s are what the client stores
 * and sends over the wire; the ONLY place they map to real engine ids is
 * lib/rag/model-map.server.ts (server-side, never bundled to the client).
 */
export const LLM_MODELS: LlmModel[] = [
  {
    id: 'opus-11',
    label: 'Opus 11',
    short: 'Opus',
    provider: 'claude',
    blurb: 'Most capable — deep reasoning'
  },
  {
    id: 'blofeld-7',
    label: 'Blofeld 7',
    short: 'Blofeld',
    provider: 'claude',
    blurb: 'Balanced speed & quality'
  },
  {
    id: 'mini-me-2',
    label: 'Mini-Me 2',
    short: 'Mini-Me',
    provider: 'claude',
    blurb: 'Fastest, lightweight'
  },
  {
    id: 'octopussy-12',
    label: 'Octopussy 12',
    short: 'Octo',
    provider: 'gemini',
    blurb: 'Fast, great for everyday answers'
  },
  {
    id: 'goldfinger-9',
    label: 'Goldfinger 9',
    short: 'Gold',
    provider: 'gemini',
    blurb: 'Slower, highest quality'
  }
];

export const DEFAULT_MODEL_ID = 'blofeld-7';

export const PROVIDER_META: Record<LlmProvider, { label: string; dot: string }> = {
  claude: { label: 'SPECTRE', dot: 'bg-orange-500' },
  gemini: { label: 'The Syndicate', dot: 'bg-blue-500' }
};

// Boards saved before the decoy rename store the OLD engine ids. Map them to
// their decoys for display/selection (keys are base64 so the client bundle
// doesn't advertise the strings; the server accepts old ids regardless).
const b64d = (s: string) =>
  typeof atob === 'function'
    ? atob(s)
    : Buffer.from(s, 'base64').toString('utf8');
const LEGACY_MODEL_IDS: Record<string, string> = Object.fromEntries(
  (
    [
  ['Y2xhdWRlLW9wdXMtNC04', 'opus-11'],
  ['Y2xhdWRlLXNvbm5ldC00LTY=', 'blofeld-7'],
  ['Y2xhdWRlLWhhaWt1LTQtNQ==', 'mini-me-2'],
  ['Z2VtaW5pLTIuNS1mbGFzaA==', 'octopussy-12'],
  ['Z2VtaW5pLTIuNS1wcm8=', 'goldfinger-9']
    ] as [string, string][]
  ).map(([k, v]) => [b64d(k), v])
);

/** Normalize any stored model id (decoy, legacy, or garbage) to a decoy id. */
export function normalizeModelId(id?: string | null): string {
  if (!id) return DEFAULT_MODEL_ID;
  if (LLM_MODELS.some((m) => m.id === id)) return id;
  return LEGACY_MODEL_IDS[id] ?? DEFAULT_MODEL_ID;
}
