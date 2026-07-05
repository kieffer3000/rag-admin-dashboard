export type LlmProvider = 'claude' | 'gemini';

export interface LlmModel {
  id: string;
  label: string;
  short: string;
  provider: LlmProvider;
  blurb: string;
}

/**
 * STACK PRIVACY (user directive 2026-07-05): user-facing labels NEVER name the
 * underlying vendor or model — competitors shouldn't be able to reverse-
 * engineer the stack from the UI, and poisoned prompts shouldn't be able to
 * phish it. Engines are branded as answersDoc series: P-Series (precision)
 * and S-Series (speed). The `id`s are internal contracts (server/Make) — do
 * NOT rename those; only labels/shorts/blurbs are display.
 */
export const LLM_MODELS: LlmModel[] = [
  {
    id: 'claude-opus-4-8',
    label: 'P1 Ultra',
    short: 'P1',
    provider: 'claude',
    blurb: 'Most capable — deep reasoning'
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'P2 Prime',
    short: 'P2',
    provider: 'claude',
    blurb: 'Balanced speed & quality'
  },
  {
    id: 'claude-haiku-4-5',
    label: 'P3 Lite',
    short: 'P3',
    provider: 'claude',
    blurb: 'Fastest, lightweight'
  },
  {
    id: 'gemini-2.5-flash',
    label: 'S1 Swift',
    short: 'S1',
    provider: 'gemini',
    blurb: 'Fast, great for everyday answers'
  },
  {
    id: 'gemini-2.5-pro',
    label: 'S2 Deep',
    short: 'S2',
    provider: 'gemini',
    blurb: 'Slower, highest quality'
  }
];

export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6';

export const PROVIDER_META: Record<LlmProvider, { label: string; dot: string }> = {
  claude: { label: 'P-Series', dot: 'bg-orange-500' },
  gemini: { label: 'S-Series', dot: 'bg-blue-500' }
};
