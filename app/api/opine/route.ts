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
  // Either a corpus OR an artifact must be wired. No corpus + an artifact →
  // ARTIFACT-ONLY mode (no Pinecone; the file rides in the model's context).
  const hasArtifactInput =
    !!body.artifact &&
    ((typeof body.artifact.content === 'string' && body.artifact.content.trim() !== '') ||
      (typeof body.artifact.url === 'string' && body.artifact.url.trim() !== ''));
  if (sourceIds.length === 0 && !hasArtifactInput) {
    return Response.json(
      { error: 'Wire a knowledge base or an artifact to the brain.' },
      { status: 400 }
    );
  }

  // ── Make relay (opt-in via env) ────────────────────────────────────────────
  // When MAKE_OPINE_WEBHOOK_URL is set, hand the artifact pipeline to the Make
  // scenario instead of running it in-code. The artifact PLUG already routed us
  // here (brain-node ~line 623); Make's internal Router branches by `kind`
  // (web/text/audio) and — in Stage 2 — by whether sources are wired. We pass the
  // RAW url for a website artifact so Make fetches the FULL html (head + schema)
  // rather than the readable-text we'd otherwise strip (which is exactly what an
  // SEO audit needs). NOTE: board audio is already transcribed upstream → it
  // arrives as `content` (kind:'text'); to exercise the CloudConvert→Whisper
  // audio route, POST raw audio to the webhook directly (kind:'audio').
  const MAKE_URL = process.env.MAKE_OPINE_WEBHOOK_URL;
  if (MAKE_URL) {
    const a = (body.artifact ?? {}) as { url?: unknown; content?: unknown; title?: unknown };
    const aUrl = typeof a.url === 'string' ? a.url.trim() : '';
    const aContent = typeof a.content === 'string' ? a.content : '';
    try {
      const mres = await fetch(MAKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: aUrl ? 'web' : 'text',
          instruction: body.instruction,
          url: aUrl || undefined,
          content: aContent || undefined,
          title: typeof a.title === 'string' ? a.title : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
          source_ids: sourceIds,
          namespace: nsForUser(userId),
          // The ROBOT (persona/instructions) + reference exemplars — forward them
          // so the relay path behaves like the in-code path (don't drop the bot).
          guides: Array.isArray(body.guides) ? body.guides : [],
          references: Array.isArray(body.references) ? body.references : [],
          citations: body.citations === 'off' ? 'off' : 'on',
          grounding: body.grounding === 'hybrid' ? 'hybrid' : 'cited',
          // Conversation for follow-ups. The COMPLETE organized JSON ships to Make
          // so it can run the Conductor + synthesis with any bot — the app does no
          // reasoning here, only assembles the payload (ASIC-only in-app rule).
          history: Array.isArray(body.history) ? body.history.slice(-HISTORY_MAX_MESSAGES) : []
        })
      });
      const text = await mres.text();
      if (!mres.ok) {
        return Response.json(
          { error: `Make relay failed (${mres.status})`, detail: text.slice(0, 500) },
          { status: 502 }
        );
      }
      // Stage 1 → Make returns a plain-text answer; Stage 2 → JSON { answer, … }.
      let out: Record<string, unknown> = { answer: text };
      try {
        const j = JSON.parse(text);
        if (j && typeof j === 'object' && 'answer' in j) out = j as Record<string, unknown>;
      } catch {
        /* plain text answer */
      }
      return Response.json({
        answer: typeof out.answer === 'string' ? out.answer : text,
        citations: [],
        raw_citations: out.raw_citations ?? null,
        used_sources: out.used_sources ?? null,
        topScore: typeof out.topScore === 'number' ? out.topScore : null,
        noMatch: Boolean(out.noMatch),
        suggestedQuestions: []
      });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : 'Make relay error' },
        { status: 502 }
      );
    }
  }
  // ── end Make relay ─────────────────────────────────────────────────────────

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
  const banner = `<p style="font-size:11px;opacity:0.55;margin:0 0 10px"><em>🔗 Working from your artifact <strong>${esc(subject)}</strong> (${(artifact?.content.trim().length ?? 0).toLocaleString()} chars) fused with ${result.pool.length} excerpts from your knowledge base.</em></p>`;

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
