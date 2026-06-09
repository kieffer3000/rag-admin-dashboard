export type LlmProvider = 'claude' | 'gemini';

export interface LlmModel {
  id: string;
  label: string;
  short: string;
  provider: LlmProvider;
  blurb: string;
}

export const LLM_MODELS: LlmModel[] = [
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    short: 'Opus',
    provider: 'claude',
    blurb: 'Most capable — deep reasoning'
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    short: 'Sonnet',
    provider: 'claude',
    blurb: 'Balanced speed & quality'
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    short: 'Haiku',
    provider: 'claude',
    blurb: 'Fastest, lightweight'
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    short: 'Flash',
    provider: 'gemini',
    blurb: 'Fast multimodal'
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    short: 'Pro',
    provider: 'gemini',
    blurb: 'Multimodal, high quality'
  }
];

export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6';

export const PROVIDER_META: Record<LlmProvider, { label: string; dot: string }> = {
  claude: { label: 'Anthropic Claude', dot: 'bg-orange-500' },
  gemini: { label: 'Google Gemini', dot: 'bg-blue-500' }
};
