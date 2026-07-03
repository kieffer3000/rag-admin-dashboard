import { auth } from '@clerk/nextjs/server';
import { getDoctrine, upsertDoctrine } from '@/lib/rag/doctrines';

// Per-Bank DOCTRINE storage (Boardroom item 1). Clerk-authed; scope = the org
// (the client) or the user, same rule as /api/board — a user can only ever
// read/write doctrines in their own scope.
//   GET ?projectId=X&bankId=Y            → { doctrine, version, updated_at, log }
//   PUT { projectId, bankId, doctrine, note? } → saves, bumps version

export const runtime = 'nodejs';

function scopeOf(orgId: string | null | undefined, userId: string) {
  return orgId ?? `user:${userId}`;
}

export async function GET(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId') ?? '';
  const bankId = url.searchParams.get('bankId') ?? '';
  if (!projectId || !bankId) {
    return Response.json({ error: 'projectId and bankId required' }, { status: 400 });
  }
  const rec = await getDoctrine(scopeOf(orgId, userId), projectId, bankId);
  return Response.json(rec);
}

export async function PUT(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON body required' }, { status: 400 });
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  const bankId = typeof body.bankId === 'string' ? body.bankId : '';
  const doctrine = typeof body.doctrine === 'string' ? body.doctrine : null;
  const note = typeof body.note === 'string' ? body.note : '';
  if (!projectId || !bankId || doctrine === null) {
    return Response.json(
      { error: 'projectId, bankId and doctrine required' },
      { status: 400 }
    );
  }
  if (doctrine.length > 40_000) {
    return Response.json(
      { error: 'Doctrine too long — keep it a one-page rubric (max 40k chars).' },
      { status: 400 }
    );
  }
  const rec = await upsertDoctrine(
    scopeOf(orgId, userId),
    userId,
    projectId,
    bankId,
    doctrine,
    note
  );
  return Response.json(rec);
}
