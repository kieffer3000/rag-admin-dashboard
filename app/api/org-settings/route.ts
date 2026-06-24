import { auth } from '@clerk/nextjs/server';
import { sql, ensureOrgSettingsSchema } from '@/lib/board-db';
import { encryptSecret } from '@/lib/crypto';
import { scopeOf } from '@/lib/org-settings';

// Per-org BYOK settings. GET → whether an OpenRouter key is set (never returns
// the key). PUT { openrouterKey } → encrypt + store (empty string clears it).

export const runtime = 'nodejs';

export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sql) return Response.json({ hasOpenrouterKey: false });
  await ensureOrgSettingsSchema();
  const rows = await sql`SELECT openrouter_key_enc FROM org_settings WHERE scope=${scopeOf(
    orgId,
    userId
  )}`;
  return Response.json({ hasOpenrouterKey: !!rows[0]?.openrouter_key_enc });
}

export async function PUT(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!sql) return Response.json({ error: 'No database' }, { status: 503 });

  const { openrouterKey } = await req.json().catch(() => ({}));
  const scope = scopeOf(orgId, userId);
  await ensureOrgSettingsSchema();

  const key = typeof openrouterKey === 'string' ? openrouterKey.trim() : '';
  if (!key) {
    await sql`
      INSERT INTO org_settings (scope, openrouter_key_enc, updated_at)
      VALUES (${scope}, NULL, now())
      ON CONFLICT (scope) DO UPDATE SET openrouter_key_enc=NULL, updated_at=now()`;
    return Response.json({ ok: true, hasOpenrouterKey: false });
  }

  let enc: string;
  try {
    enc = encryptSecret(key);
  } catch {
    return Response.json(
      { error: 'Encryption not configured (APP_ENCRYPTION_KEY).' },
      { status: 503 }
    );
  }
  await sql`
    INSERT INTO org_settings (scope, openrouter_key_enc, updated_at)
    VALUES (${scope}, ${enc}, now())
    ON CONFLICT (scope) DO UPDATE SET openrouter_key_enc=${enc}, updated_at=now()`;
  return Response.json({ ok: true, hasOpenrouterKey: true });
}
