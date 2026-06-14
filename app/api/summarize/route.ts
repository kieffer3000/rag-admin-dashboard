import { auth } from '@clerk/nextjs/server';

// Rolling-summary updater for long conversations — folds messages that scrolled
// out of the verbatim window into a compact running summary so far-back facts
// survive for the history-aware query rewrite.
//
// The summarizing LLM lives in a Make.com scenario (MAKE_SUMMARIZE_WEBHOOK_URL),
// NOT in code — so the model version is managed in the Make UI alongside the
// other RAG models and never silently drifts. This route is a thin auth'd proxy
// (webhook URL stays server-side; the repo is public). It degrades to a no-op
// (returns the prior summary unchanged) until the Make scenario is wired.
//
// Make "rag summarize" scenario contract:
//   request:  { summary, messages:[{role,content}] }
//   response: { summary }   (the updated rolling summary)
// The summary itself is stored on the brain by the client, so it persists with
// the conversation and is deleted automatically when the conversation is cleared.

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { summary?: string; messages?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const prior = typeof body.summary === 'string' ? body.summary : '';

  const url = process.env.MAKE_SUMMARIZE_WEBHOOK_URL;
  if (!url) {
    // Not wired yet — no-op so long conversations still work (just without
    // far-back compression). Keeps the feature inert until the Make scenario
    // exists.
    return Response.json({ summary: prior, configured: false });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: prior,
        messages: Array.isArray(body.messages) ? body.messages : []
      })
    });
    if (!res.ok) return Response.json({ summary: prior, configured: true });
    const data = await res.json().catch(() => ({}));
    const next =
      typeof data?.summary === 'string' && data.summary.trim()
        ? data.summary.trim()
        : prior;
    return Response.json({ summary: next, configured: true });
  } catch {
    return Response.json({ summary: prior, configured: true });
  }
}
