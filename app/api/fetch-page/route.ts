import { auth } from '@clerk/nextjs/server';
import { fetchReadablePage } from '@/lib/rag/web-extract';

// Fetch-only page reader for the Opine ARTIFACT (right plug). Returns the page's
// readable text + hero image WITHOUT indexing it (an artifact must never enter
// Pinecone). All guardrails live in lib/rag/web-extract. Soft failures come back
// as { ok:false, note } with HTTP 200 so the node can show the user a clear note.

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url = body?.url;
  if (!url || typeof url !== 'string') {
    return Response.json({ ok: false, note: 'A URL is required.' }, { status: 200 });
  }

  const result = await fetchReadablePage(url, typeof body?.name === 'string' ? body.name : undefined);
  return Response.json(result, { status: 200 });
}
