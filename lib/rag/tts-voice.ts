// Read-aloud voice preference (Build 3.40). A per-browser choice, applied to
// every voiceover (manual 🔈 and Audio Mode). Stored in localStorage; the route
// falls back to GOOGLE_TTS_VOICE if the client ever omits one.
//
// Voice ids are REAL Google Cloud WaveNet voices, verified live from the
// texttospeech.googleapis.com /voices endpoint (2026-07-23) — not guessed.

export interface TtsVoice {
  id: string;
  label: string;
}

export const TTS_VOICES: TtsVoice[] = [
  { id: 'en-US-Wavenet-F', label: '🇺🇸 US · Female' },
  { id: 'en-US-Wavenet-C', label: '🇺🇸 US · Female (alt)' },
  { id: 'en-US-Wavenet-D', label: '🇺🇸 US · Male' },
  { id: 'en-US-Wavenet-J', label: '🇺🇸 US · Male (alt)' },
  { id: 'en-GB-Wavenet-A', label: '🇬🇧 UK · Female' },
  { id: 'en-GB-Wavenet-B', label: '🇬🇧 UK · Male' },
  { id: 'en-AU-Wavenet-C', label: '🇦🇺 AU · Female' },
  { id: 'en-AU-Wavenet-B', label: '🇦🇺 AU · Male' }
];

const KEY = 'answersdoc_tts_voice';
const DEFAULT = 'en-US-Wavenet-F';

export function getVoice(): string {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    return localStorage.getItem(KEY) || DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setVoice(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode — the choice just won't persist across reloads */
  }
}

export function voiceLabel(id: string): string {
  return TTS_VOICES.find((v) => v.id === id)?.label ?? id;
}
