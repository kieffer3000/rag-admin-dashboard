import { auth } from '@clerk/nextjs/server';
import { nsForUser } from '@/lib/rag/namespace';
import { scopeOf } from '@/lib/org-settings';
import {
  createConnection,
  listConnections,
  deleteConnection,
  updateConnectionSources
} from '@/lib/rag/connections';

// Owner-side management of published connections (Clerk-gated). The public
// Q&A endpoint is /api/v1/ask (key-authed). namespace is ALWAYS derived from the
// signed-in owner here — a client never supplies it.

export const runtime = 'nodejs';

export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await listConnections(scopeOf(orgId, userId));
  return Response.json({ connections: rows });
}

export async function POST(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* ignore */
  }

  const sourceIds = Array.isArray(body.sourceIds)
    ? (body.sourceIds as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  if (sourceIds.length === 0) {
    return Response.json(
      { error: 'Wire at least one source into the Answers Bank before publishing.' },
      { status: 400 }
    );
  }
  const allowedOrigins = Array.isArray(body.allowedOrigins)
    ? (body.allowedOrigins as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  if (allowedOrigins.length === 0) {
    return Response.json(
      { error: 'Add at least one allowed website — the key is locked to that domain.' },
      { status: 400 }
    );
  }

  const created = await createConnection({
    scope: scopeOf(orgId, userId),
    userId,
    label: typeof body.label === 'string' ? body.label : 'Untitled',
    namespace: nsForUser(userId),
    sourceIds,
    answerMode: body.answerMode === 'hybrid' ? 'hybrid' : 'cited',
    model: typeof body.model === 'string' ? body.model : '',
    speed: typeof body.speed === 'string' ? body.speed : 'detailed',
    allowSpeedChoice: body.allowSpeedChoice === true,
    allowedOrigins,
    // Bank link → auto-sync follows this Bank's live wiring.
    bankNodeId: typeof body.bankNodeId === 'string' ? body.bankNodeId : undefined,
    projectId: typeof body.projectId === 'string' ? body.projectId : undefined
  });

  if (!created) {
    return Response.json(
      { error: 'Storage is not configured (POSTGRES_URL missing).' },
      { status: 500 }
    );
  }

  // The plaintext key is returned ONCE here and never again.
  return Response.json({ connection: created.row, key: created.key });
}

export async function PATCH(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
  const sourceIds = Array.isArray(body.sourceIds)
    ? (body.sourceIds as unknown[]).filter((s): s is string => typeof s === 'string')
    : undefined;
  await updateConnectionSources(scopeOf(orgId, userId), id, {
    sourceIds,
    answerMode: typeof body.answerMode === 'string' ? body.answerMode : undefined,
    model: typeof body.model === 'string' ? body.model : undefined,
    speed: typeof body.speed === 'string' ? body.speed : undefined,
    allowSpeedChoice:
      typeof body.allowSpeedChoice === 'boolean' ? body.allowSpeedChoice : undefined,
    label: typeof body.label === 'string' ? body.label : undefined,
    allowedOrigins: Array.isArray(body.allowedOrigins)
      ? (body.allowedOrigins as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined,
    // Stamping these on a Re-sync adopts a LEGACY connection into auto-sync.
    bankNodeId: typeof body.bankNodeId === 'string' ? body.bankNodeId : undefined,
    projectId: typeof body.projectId === 'string' ? body.projectId : undefined
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
  await deleteConnection(scopeOf(orgId, userId), id);
  return Response.json({ ok: true });
}
