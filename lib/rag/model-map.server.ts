/**
 * SERVER-ONLY decoy → real engine-id map. The client (bundle, storage, wire)
 * speaks exclusively in villain codenames (lib/rag/models.ts); this file is
 * imported ONLY by API routes, so the real ids never reach a browser. Legacy
 * ids stored by old boards/connections pass through untouched.
 */
const REAL_MODEL_IDS: Record<string, string> = {
  'opus-11': 'claude-opus-4-8',
  'blofeld-7': 'claude-sonnet-4-6',
  'mini-me-2': 'claude-haiku-4-5',
  'octopussy-12': 'gemini-2.5-flash',
  'goldfinger-9': 'gemini-2.5-pro'
};

export function resolveRealModelId(
  id?: string | null,
  fallback = 'gemini-2.5-flash'
): string {
  const v = (id ?? '').trim();
  if (!v) return fallback;
  return REAL_MODEL_IDS[v] ?? v;
}
