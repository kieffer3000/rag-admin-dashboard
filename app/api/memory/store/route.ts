import { auth } from '@clerk/nextjs/server';
import { runUtilityLLM } from '@/lib/rag/utility-llm';
import { storeMemory } from '@/lib/rag/memory';

// Stores a long-term memory of a Q&A: summarizes it densely (via the Make
// utility LLM) then embeds + upserts it to the memory namespace. Called by the
// brain after each grounded answer.

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.RAG_MEMORY === 'off') return Response.json({ stored: false });

  let body: { question?: string; answer?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const q = String(body.question ?? '').trim();
  // strip HTML + chart/mermaid blocks from the answer before summarizing
  const a = String(body.answer ?? '')
    .replace(/```(?:chart|mermaid)[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!q || !a) return Response.json({ error: 'question and answer required' }, { status: 400 });

  const summary = await runUtilityLLM(
    `Write a concise, information-dense, self-contained summary of this Q&A so a future AI can recall it. Preserve names, numbers, dates and key facts. Start with the topic. 2–4 sentences. Output only the summary.\n\nQuestion: ${q}\nAnswer: ${a.slice(0, 2500)}`,
    { temperature: 0.2, maxOutputTokens: 220 }
  );
  const text =
    summary && summary.trim()
      ? summary.trim()
      : `Q: ${q} — A: ${a.slice(0, 400)}`;

  const stored = await storeMemory(text, userId);
  return Response.json({ stored });
}
