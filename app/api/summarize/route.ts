import { auth } from '@clerk/nextjs/server';
import { runUtilityLLM } from '@/lib/rag/utility-llm';

// Rolling-summary updater for long conversations — folds messages that scrolled
// out of the verbatim window into a compact running summary so far-back facts
// survive for the history-aware query rewrite.
//
// Runs through the shared LLM-utility gateway (Make "rag-llm-utility" webhook
// when wired, else direct Gemini fallback) so the model lives in the Make UI.
// The summary is stored on the brain by the client → persists with the
// conversation and is deleted automatically when it's cleared.

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { summary?: string; messages?: { role?: string; content?: string }[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const prior = typeof body.summary === 'string' ? body.summary.trim() : '';
  const messagesText = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => typeof m?.content === 'string' && m.content!.trim())
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content!.slice(0, 800)}`)
    .join('\n');
  if (!messagesText) return Response.json({ summary: prior });

  const prompt = `You maintain a running summary of a conversation so its key facts survive after the raw messages scroll out of view. Fold the NEW messages into the summary so far, preserving every name, place, number, date, and established fact. Be factual and third-person. Keep the whole summary under 180 words. Output ONLY the updated summary, no preamble.\n\nSummary so far:\n${prior || '(none yet)'}\n\nNew messages to fold in:\n${messagesText}`;

  const next = await runUtilityLLM(prompt, { temperature: 0.2, maxOutputTokens: 400 });
  return Response.json({ summary: next && next.trim() ? next.trim() : prior });
}
