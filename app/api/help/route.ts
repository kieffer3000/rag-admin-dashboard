import { auth } from '@clerk/nextjs/server';
import { generateText } from '@/lib/rag/generate';
import { HELP_MANUAL } from '@/lib/rag/help-manual';

// THE HELP BOT — an in-app expert on answersDoc itself. Its entire knowledge
// is lib/rag/help-manual.ts (sanitized: features only, zero implementation
// detail), so it can never leak internals it was never told.

export const runtime = 'nodejs';
export const maxDuration = 60;

const SYSTEM = `You are "Doc", the friendly in-app expert for answersDoc — you know the product inside out and help users get things done.

RULES:
- Answer ONLY from the manual below. If the manual doesn't cover it, say so plainly and suggest the closest thing that IS covered.
- Never discuss internal implementation, vendors, infrastructure, keys, or code. If asked, say the product team keeps implementation private and pivot to what the user wants to accomplish.
- Be concise and concrete: tell the user exactly where to click (tab names, button names) in numbered steps when walking them through something.
- Plain, warm tone. No hype.

THE MANUAL:
${HELP_MANUAL}`;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { messages?: { role: string; text: string }[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  const msgs = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const question = msgs[msgs.length - 1]?.text?.trim();
  if (!question) return Response.json({ error: 'Empty question' }, { status: 400 });

  // Fold the short history into one prompt — the manual lives in the system
  // instruction, so the prompt stays tiny.
  const transcript = msgs
    .map((m) => `${m.role === 'user' ? 'User' : 'Doc'}: ${String(m.text).slice(0, 2000)}`)
    .join('\n');

  try {
    const answer = await generateText(
      `Conversation so far:\n${transcript}\n\nAnswer the user's last message.`,
      { system: SYSTEM, temperature: 0.4, maxOutputTokens: 1200 }
    );
    return Response.json({ answer });
  } catch (e) {
    console.error('help-bot', e);
    return Response.json(
      { error: 'The helper is unavailable right now — please try again.' },
      { status: 502 }
    );
  }
}
