import 'server-only';
import { sql, ensureOrgSettingsSchema } from '@/lib/board-db';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { getOrgOpenrouterKey } from '@/lib/org-settings';

// MANAGED OPENROUTER SUB-KEYS (Build 3.17). For scopes that DON'T bring their
// own key, we don't build an LLM-spend ledger — we rent one: OpenRouter's
// provisioning API mints a per-scope sub-key with a hard USD `limit` that
// auto-resets monthly (`limit_reset`). The sub-key IS the meter, the cap, and
// the kill switch — overspend is structurally impossible even if our code has
// a bug, because OpenRouter stops serving the key.
// Docs verified 2026-07-06: openrouter.ai/docs/features/provisioning-api-keys
//
// The frozen Make contract already accepts a per-request `openrouter_key`
// (built for BYOK) — the sub-key rides the same field. Precedence:
//   BYOK (org's own key) → managed sub-key → '' (Make's house connection).
// No OPENROUTER_PROVISIONING_KEY env set = managed lane OFF = today's exact
// behavior. Fail-open to '' on every error.

let colEnsured = false;
async function ensureManagedKeyColumn() {
  if (!sql || colEnsured) return;
  await ensureOrgSettingsSchema();
  await sql`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS managed_or_key_enc text`;
  colEnsured = true;
}

async function mintSubKey(scope: string, usdLimit: number): Promise<string> {
  const prov = process.env.OPENROUTER_PROVISIONING_KEY;
  if (!prov) return '';
  try {
    const r = await fetch('https://openrouter.ai/api/v1/keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${prov}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `answersdoc ${scope}`,
        limit: usdLimit,
        limit_reset: 'monthly'
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!r.ok) {
      console.warn(`[or-provision] mint failed HTTP ${r.status} for ${scope}`);
      return '';
    }
    const j = await r.json();
    // The plaintext key is returned ONCE at creation (shape has varied between
    // `key` at the top level and under `data`).
    const k = (j?.key ?? j?.data?.key ?? '') as string;
    return typeof k === 'string' && k ? k : '';
  } catch {
    return '';
  }
}

/**
 * The OpenRouter key an answer for `scope` should ride:
 * BYOK if the org set one; else the scope's managed sub-key (minted on first
 * use, spend-capped at `managedUsdLimit`/month) when provisioning is
 * configured; else '' — Make's house connection key, today's behavior.
 * `managedUsdLimit` 0/absent = never mint (owners ride the house key).
 */
export async function getAnswerKey(
  scope: string,
  managedUsdLimit: number
): Promise<string> {
  const byok = await getOrgOpenrouterKey(scope);
  if (byok) return byok;
  if (!managedUsdLimit || managedUsdLimit <= 0) return '';
  if (!process.env.OPENROUTER_PROVISIONING_KEY || !sql) return '';
  try {
    await ensureManagedKeyColumn();
    const rows = await sql`SELECT managed_or_key_enc FROM org_settings WHERE scope=${scope}`;
    const enc = rows[0]?.managed_or_key_enc as string | undefined;
    if (enc) return decryptSecret(enc);

    const k = await mintSubKey(scope, managedUsdLimit);
    if (!k) return '';
    const kEnc = encryptSecret(k);
    await sql`
      INSERT INTO org_settings (scope, managed_or_key_enc, updated_at)
      VALUES (${scope}, ${kEnc}, now())
      ON CONFLICT (scope)
      DO UPDATE SET managed_or_key_enc=${kEnc}, updated_at=now()`;
    console.info(`[or-provision] minted managed sub-key for ${scope} ($${managedUsdLimit}/mo)`);
    return k;
  } catch {
    return '';
  }
}
