import { auth } from '@clerk/nextjs/server';
import { nsForUser } from '@/lib/rag/namespace';
import { runOpine, type Artifact } from '@/lib/rag/opine';
import { fetchReadablePage } from '@/lib/rag/web-extract';

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

  // RIGHT plug — the artifact, carried whole, NEVER indexed. Present when it has
  // content OR a URL; if content is empty but a URL is set, the server loads the
  // page text here (with the JS-render fallback) so Opine works even if the node
  // hadn't finished loading client-side.
  let artifact: Artifact | null = null;
  if (body.artifact) {
    const content = typeof body.artifact.content === 'string' ? body.artifact.content : '';
    const url = typeof body.artifact.url === 'string' ? body.artifact.url.trim() : '';
    const title = typeof body.artifact.title === 'string' ? body.artifact.title : undefined;
    let resolved = content;
    // Thin content (empty, or just a nav snippet) + a URL → load the full page
    // text server-side. Guards against asking before the node finished loading.
    if (content.trim().length < 200 && url) {
      const p = await fetchReadablePage(url);
      if (p.ok && p.text && p.text.length > content.trim().length) resolved = p.text;
    }
    artifact = { content: resolved, title, url: url || undefined };
  }

  // An artifact is wired but there's no usable text to critique → EXPLAIN what's
  // happening and why, instead of silently answering generically from the corpus.
  if (artifact && artifact.content.trim().length < 200) {
    const hadUrl = !!artifact.url;
    const why = hadUrl
      ? 'I tried to load that page but couldn’t read its text — it may be paywalled, login-gated, or rendered entirely in JavaScript.'
      : 'The artifact has no text in it yet.';
    const how = hadUrl
      ? 'Click <strong>Load</strong> on the artifact (or paste the page’s text in directly), then ask again.'
      : 'Paste the text into the artifact, or add a URL and click <strong>Load</strong>, then ask again.';
    return Response.json({
      answer: `<p><strong>I can’t critique your page yet — there’s no readable text in the wired artifact.</strong> ${why}</p><p>${how} Until it has text, I can only answer <em>generally</em> from your wired sources — I can’t evaluate <em>your specific page</em>.</p>`,
      citations: [],
      raw_citations: null,
      used_sources: null,
      topScore: null,
      noMatch: true,
      suggestedQuestions: []
    });
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

  // Self-identifying banner so it's UNMISTAKABLE that this is Opine (critiquing
  // the artifact), not generic corpus Q&A — and proof the page text reached the
  // engine (the char count). If you ever see a generic answer WITHOUT this line,
  // the artifact text didn't reach the brain (stale client bundle / not wired).
  const subject = (artifact?.title || '').trim() || (artifact?.url ? artifact.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'your artifact');
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
  const banner = `<p style="font-size:11px;opacity:0.55;margin:0 0 10px"><em>🔍 Opine — critiquing <strong>${esc(subject)}</strong> (${(artifact?.content.trim().length ?? 0).toLocaleString()} chars) against ${result.pool.length} corpus excerpts.</em></p>`;

  return Response.json({
    answer: banner + result.answer,
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
