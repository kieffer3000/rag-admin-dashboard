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

  const prompt = `You maintain a running WORKING-MEMORY summary of a conversation so its key facts survive after the raw messages scroll out of the verbatim window. This summary is later used to RESOLVE REFERENCES (e.g. "his house", "that tool", "she") in follow-up questions, so it MUST make every antecedent recoverable.

Fold the NEW messages into the summary so far. REQUIREMENTS:
- Begin with a line "Current subject(s): <the person/thing/topic currently under discussion>" so pronouns in the next question can be resolved.
- Preserve EVERY proper name, place, number, date, URL, and established fact. Never replace a name with a pronoun — write the actual name.
- Note any entity a pronoun could later refer to (people, products, organizations, locations).
- Be factual, third-person, no commentary.
- Keep the whole summary under 220 words. Output ONLY the updated summary, no preamble.

Summary so far:
${prior || '(none yet)'}

New messages to fold in:
${messagesText}`;

  const next = await runUtilityLLM(prompt, { temperature: 0.2, maxOutputTokens: 480 });
  return Response.json({ summary: next && next.trim() ? next.trim() : prior });
}
