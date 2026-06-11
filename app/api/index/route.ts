import { auth } from '@clerk/nextjs/server';

// Proxies Board ingestion to the Make.com Indexing scenario.
// Contract (FROZEN): { source_id, name, type, namespace, text }
// → Gemini Embedding (768d) → Pinecone upsert with metadata.

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.MAKE_INDEX_WEBHOOK_URL;
  if (!url) {
    return Response.json(
      { error: 'MAKE_INDEX_WEBHOOK_URL is not configured' },
      { status: 503 }
    );
  }

  const body = await req.json();
  if (!body.source_id || !body.text) {
    return Response.json(
      { error: 'source_id and text are required' },
      { status: 400 }
    );
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_id: body.source_id,
      name: body.name ?? body.source_id,
      type: body.type ?? 'text',
      namespace: process.env.PINECONE_NAMESPACE ?? 'user_kieffer',
      text: body.text
    })
  });

  if (!res.ok) {
    return Response.json(
      { error: `Indexing webhook returned ${res.status}` },
      { status: 502 }
    );
  }

  return Response.json({ status: 'indexed', source_id: body.source_id });
}
