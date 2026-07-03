import { openCors } from '@/lib/rag/public-api';
import { getRoomBySlug, roomExperts } from '@/lib/rag/rooms';

// PUBLIC room config for the embeddable Boardroom widget. Given a room slug
// (x-room-id header or ?slug=), returns the seated experts as { label, embedSlug }
// so the widget can fan a question out to each via /api/v1/ask + /api/v1/opine.
// Returns ONLY non-secret data (labels + public embed slugs — each of which is
// itself domain-locked when called). The widget page is frame-locked by
// middleware; this endpoint is the widget's config read.

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: openCors(req.headers.get('origin')) });
}

export async function GET(req: Request) {
  const cors = openCors(req.headers.get('origin'));
  const url = new URL(req.url);
  const slug = (req.headers.get('x-room-id') || url.searchParams.get('slug') || '').trim();
  if (!slug) return Response.json({ error: 'Missing room id.' }, { status: 400, headers: cors });

  const room = await getRoomBySlug(slug);
  if (!room) return Response.json({ error: 'Unknown room.' }, { status: 404, headers: cors });

  const experts = await roomExperts(room);
  return Response.json(
    { label: room.label, allowTable: room.allow_table, experts },
    { headers: cors }
  );
}
