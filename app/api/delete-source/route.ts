import { auth } from '@clerk/nextjs/server';
import { deleteSourceVectors } from '@/lib/rag/pinecone-delete';

// Deletes a source's vectors from Pinecone when the user deletes the source
// from their knowledge base. No Make scenario needed — it's a direct Pinecone
// delete (same mechanism as delete-before-reindex).

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { source_id?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.source_id) {
    return Response.json({ error: 'source_id is required' }, { status: 400 });
  }

  const namespace = process.env.PINECONE_NAMESPACE ?? 'user_kieffer';
  const deleted = await deleteSourceVectors(body.source_id, namespace);
  return Response.json({ status: 'deleted', source_id: body.source_id, deleted });
}
