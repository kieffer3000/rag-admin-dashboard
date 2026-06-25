import { auth } from '@clerk/nextjs/server';
import { nsForUser } from '@/lib/rag/namespace';
import { runOpine, type Artifact } from '@/lib/rag/opine';

// "Opine" — the wired corpus (LEFT plug) reasons ABOUT an artifact (RIGHT plug),
// optionally guided by references (TOP plug) and a robot persona (guides). Unlike
// /api/query (a relay to Make), the two-pass rubric→check ORCHESTRATION runs here
// and synthesis is in-code (lib/rag/opine + lib/rag/generate). See
// agent_files/rag/projects/BRAIN_PLUGS_OPINE_DESIGN.md.
//
// Request:  { instruction, artifact?, references?, source_ids[], citations?,
//             grounding?, guides?, history?, project_id? }
// Response: same shape as /api/query so the chat UI renders it unchanged
//           ({ answer, citations, raw_citations, used_sources, topScore, noMatch,
//             suggestedQuestions, plan }). When citations are OFF, raw_citations is
//           null so no footnotes render.

export const runtime = 'nodejs';

const NOMATCH_THRESHOLD = Number(process.env.RAG_NOMATCH_THRESHOLD ?? 0.6);
const HISTORY_MAX_MESSAGES = 30;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.instruction !== 'string' || !body.instruction.trim()) {
    return Response.json({ error: 'instruction is required' }, { status: 400 });
  }

  const sourceIds: string[] = Array.isArray(body.source_ids)
    ? body.source_ids.filter((s: unknown) => typeof s === 'string' && s)
    : [];
  if (sourceIds.length === 0) {
    return Response.json(
      { error: 'source_ids are required (wire a corpus to the brain)' },
      { status: 400 }
    );
  }

  // RIGHT plug — the artifact, carried whole, NEVER indexed.
  let artifact: Artifact | null = null;
  if (body.artifact && typeof body.artifact.content === 'string' && body.artifact.content.trim()) {
    artifact = {
      content: body.artifact.content,
      title: typeof body.artifact.title === 'string' ? body.artifact.title : undefined,
      url: typeof body.artifact.url === 'string' ? body.artifact.url : undefined
    };
  }

  // TOP plug — reference exemplars / clues (optional, not citable).
  const references: Artifact[] = Array.isArray(body.references)
    ? body.references
        .filter((r: unknown) => r && typeof (r as Artifact).content === 'string')
        .map((r: Artifact) => ({ content: r.content, title: r.title }))
        .slice(0, 5)
    : [];

  // Robot — agent/prompt persona(s). Voice/priorities only, never grounding.
  const guides: string[] = Array.isArray(body.guides)
    ? body.guides.filter((g: unknown) => typeof g === 'string' && g.trim())
    : [];

  const citations: 'on' | 'off' = body.citations === 'off' ? 'off' : 'on';
  const grounding: 'cited' | 'hybrid' = body.grounding === 'hybrid' ? 'hybrid' : 'cited';

  // Multi-turn: preformatted recent history (deterministic, no LLM).
  const conversation = (Array.isArray(body.history) ? body.history : [])
    .filter(
      (h: unknown): h is { role: string; content: string } =>
        !!h && typeof (h as { content?: unknown }).content === 'string' &&
        (h as { content: string }).content.trim().length > 0
    )
    .slice(-HISTORY_MAX_MESSAGES)
    .map((h: { role: string; content: string }) =>
      `${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.content}`
    )
    .join('\n');

  const ns = nsForUser(userId);

  let result;
  try {
    result = await runOpine({
      instruction: body.instruction,
      namespace: ns,
      sourceIds,
      artifact,
      references,
      citations,
      grounding,
      guides,
      conversation
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Opine failed' },
      { status: 502 }
    );
  }

  // Aggregator-shaped raw_citations so the client's [n] footnote pipeline links to
  // sources — only when citations are ON.
  const raw_citations =
    citations === 'on' && result.pool.length
      ? JSON.stringify(
          result.pool.map((c) => ({
            score: c.score,
            metadata: { source_id: c.source_id, source_name: c.source_name, text: c.text }
          }))
        )
      : null;

  return Response.json({
    answer: result.answer,
    citations: [],
    raw_citations,
    used_sources: null,
    topScore: result.topScore,
    noMatch: result.topScore === null || result.topScore < NOMATCH_THRESHOLD,
    suggestedQuestions: [],
    // Debug/insight: what the Conductor decided + how much evidence it pulled.
    plan: { ...result.plan, poolSize: result.pool.length }
  });
}
