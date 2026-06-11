import { auth } from '@clerk/nextjs/server';

// Proxies the Board's brain queries to the Make.com Query scenario.
// The webhook contract is FROZEN (see BOARD_SPEC.md):
//   request:  { question, source_ids[], scope, namespace, model }
//   response: { answer, citations: [{ source_name, source_id, snippet, score }] }
// Webhook URL stays server-side — this repo is public.

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.MAKE_QUERY_WEBHOOK_URL;
  if (!url) {
    return Response.json(
      { error: 'MAKE_QUERY_WEBHOOK_URL is not configured' },
      { status: 503 }
    );
  }

  const body = await req.json();
  const sourceIds: string[] = body.source_ids ?? [];
  const contextTexts: string[] = body.context_texts ?? [];

  if (!body.question || sourceIds.length === 0) {
    return Response.json(
      { error: 'question and source_ids are required' },
      { status: 400 }
    );
  }

  // Ephemeral text-node context rides in the prompt — never indexed.
  const question = contextTexts.length
    ? `Context from the user (not a source, do not cite): ${contextTexts.join(
        ' | '
      )}\n\nQuestion: ${body.question}`
    : body.question;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      source_ids: sourceIds,
      // Pre-built Pinecone metadata filter. Make's Simple Filter UI only
      // carries scalar values (multi-id arrays get string-coerced -> zero
      // matches), so the scenario maps this verbatim instead.
      filter_json: JSON.stringify({ source_id: { $in: sourceIds } }),
      scope: 'selected',
      namespace: process.env.PINECONE_NAMESPACE ?? 'user_kieffer',
      model: body.model ?? 'gemini-2.5-flash'
    })
  });

  if (!res.ok) {
    return Response.json(
      { error: `Query webhook returned ${res.status}` },
      { status: 502 }
    );
  }

  const data = await res.json();
  // Zero-match runs emit one hollow citation element — filter it here.
  const citations = (data.citations ?? []).filter(
    (c: { source_id?: string | null }) => c && c.source_id
  );

  return Response.json({ answer: data.answer ?? '', citations });
}
