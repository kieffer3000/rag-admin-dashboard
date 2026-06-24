import 'server-only';
import { sql, ensureOrgSettingsSchema } from '@/lib/board-db';
import { decryptSecret } from '@/lib/crypto';

// Scope = the Clerk org if present, else the user — same convention as the board
// tables. BYOK (the OpenRouter key) is billed/shared per ORG.
export function scopeOf(orgId: string | null | undefined, userId: string) {
  return orgId ?? `user:${userId}`;
}

/** The org's decrypted OpenRouter key, or '' if none / on any error. Safe to
 *  call anywhere server-side. */
export async function getOrgOpenrouterKey(scope: string): Promise<string> {
  if (!sql) return '';
  try {
    await ensureOrgSettingsSchema();
    const rows = await sql`SELECT openrouter_key_enc FROM org_settings WHERE scope=${scope}`;
    const enc = rows[0]?.openrouter_key_enc as string | undefined;
    return enc ? decryptSecret(enc) : '';
  } catch {
    return '';
  }
}
