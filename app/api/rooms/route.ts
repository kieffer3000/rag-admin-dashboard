import { auth } from '@clerk/nextjs/server';
import { scopeOf } from '@/lib/org-settings';
import { createRoom, listRooms, deleteRoom } from '@/lib/rag/rooms';

// Owner-side management of embeddable ROOMS (Clerk-gated). A room bundles N
// published connections into one public, domain-locked iframe. The public
// surface is /embed/room/<slug> (no keys in the page — see lib/rag/rooms.ts).

export const runtime = 'nodejs';

export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await listRooms(scopeOf(orgId, userId));
  return Response.json({ rooms: rows });
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

  const memberIds = Array.isArray(body.memberIds)
    ? (body.memberIds as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  if (memberIds.length === 0) {
    return Response.json(
      { error: 'Pick at least one published Bank to seat in the room.' },
      { status: 400 }
    );
  }
  const allowedOrigins = Array.isArray(body.allowedOrigins)
    ? (body.allowedOrigins as unknown[]).filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0
      )
    : [];
  if (allowedOrigins.length === 0) {
    return Response.json(
      { error: 'Add at least one allowed website — the room is frame-locked to that domain.' },
      { status: 400 }
    );
  }

  const room = await createRoom({
    scope: scopeOf(orgId, userId),
    userId,
    label: typeof body.label === 'string' ? body.label : 'Boardroom',
    memberIds,
    allowedOrigins,
    allowTable: body.allowTable !== false
  });
  if (!room) return Response.json({ error: 'Could not create room (no DB?)' }, { status: 500 });
  return Response.json({ room });
}

export async function DELETE(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const slug = new URL(req.url).searchParams.get('slug') ?? '';
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 });
  await deleteRoom(scopeOf(orgId, userId), slug);
  return Response.json({ ok: true });
}
