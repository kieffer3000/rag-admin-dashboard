import { authorizeConnection, rateLimited, openCors } from '@/lib/rag/public-api';
import { runOpine, type Artifact } from '@/lib/rag/opine';
import { fetchReadablePage } from '@/lib/rag/web-extract';

// PUBLIC, key-authed OPINE (critique-on-artifact) over one published Answers
// Bank — the external twin of the in-app /api/opine. NOT Clerk-gated (see
// middleware isPublicRoute) — the per-Bank API key is the credential and
// resolves server-side to { namespace, source_ids }, so a caller can only ever
// reason over THAT Bank's corpus. The caller supplies the artifact to critique
// (e.g. "review this hook"); the Bank's wired Library + optional doctrine
// `guides` steer the judgment. Answer text only — no citations over the wire.
//
// Request:  { instruction (required), artifact?: { content?, url?, title? },
//             references?: [{content,title?}], guides?: string[],
//             grounding?: 'cited'|'hybrid', conversation?|history?: [{role,content}] }
// Response: { answer, bank }  (or { error })

export const runtime = 'nodejs';
// Opine's two-pass rubric→check reasoning (in Make) can run long, like Research
// on /api/v1/ask. Match the project Fluid ceiling so it's never cut mid-flight.
export const maxDuration = 300;

const HISTORY_MAX = 30;

/** The public endpoint is citation-FREE — drop <mark> highlights + numeric [n]
 *  footnote markers, leaving real bracketed text (e.g. [Free]) intact. */
function stripCitations(html: string): string {
  return (html ?? '')
    .replace(/<\/?mark[^>]*>/gi, '')
    .replace(/\s*\[\d+(?:\s*[,;–-]\s*\d+)*\](?:\s*\[\d+(?:\s*[,;–-]\s*\d+)*\])*/g, '')
    .trim();
}

function formatConversation(body: Record<string, unknown>): string {
  const turns = Array.isArray(body.conversation)
    ? body.conversation
    : Array.isArray(body.history)
      ? body.history
      : [];
  return turns
    .filter(
      (t): t is { role?: string; content: string } =>
        !!t &&
        typeof (t as { content?: unknown }).content === 'string' &&
        (t as { content: string }).content.trim().length > 0
    )
    .slice(-HISTORY_MAX)
    .map((t) => `${t.role === 'assistant' ? 'Assistant' : 'User'}: ${t.content}`)
    .join('\n');
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: openCors(req.headers.get('origin')) });
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body ok */
  }

  const a = await authorizeConnection(req, body);
  if ('error' in a) {
    return Response.json({ error: a.error }, { status: a.status, headers: a.headers });
  }
  const conn = a.conn;
  const cors = a.headers;

  if (rateLimited(conn.id)) {
    return Response.json({ error: 'Rate limit exceeded — slow down.' }, { status: 429, headers: cors });
  }

  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction) {
    return Response.json(
      { error: 'An "instruction" string is required (what to critique / how).' },
      { status: 400, headers: cors }
    );
  }

  // The artifact to opine on (caller-supplied, per request). Scope (namespace +
  // source_ids) always comes from the CONNECTION, never the client.
  const rawArtifact = (body.artifact ?? {}) as { url?: unknown; content?: unknown; title?: unknown };
  const aUrl = typeof rawArtifact.url === 'string' ? rawArtifact.url.trim() : '';
  const aContent = typeof rawArtifact.content === 'string' ? rawArtifact.content : '';
  const aTitle = typeof rawArtifact.title === 'string' ? rawArtifact.title : undefined;
  const hasArtifact = aContent.trim() !== '' || aUrl !== '';

  if (conn.source_ids.length === 0 && !hasArtifact) {
    return Response.json(
      { error: 'Nothing to reason over — this Bank has no wired sources and no artifact was supplied.' },
      { status: 409, headers: cors }
    );
  }

  const guides: string[] = Array.isArray(body.guides)
    ? (body.guides as unknown[]).filter((g): g is string => typeof g === 'string' && g.trim() !== '')
    : [];
  const references: Artifact[] = Array.isArray(body.references)
    ? (body.references as unknown[])
        .filter((r): r is Artifact => !!r && typeof (r as Artifact).content === 'string')
        .map((r) => ({ content: r.content, title: r.title }))
        .slice(0, 5)
    : [];
  const grounding: 'cited' | 'hybrid' = body.grounding === 'hybrid' ? 'hybrid' : 'cited';
  const conversation = formatConversation(body);
  const filterJson = conn.source_ids.length
    ? JSON.stringify({ source_id: { $in: conn.source_ids } })
    : undefined;

  try {
    // ── Prod path: relay to the Make opine scenario (mirrors /api/opine). ──
    const MAKE_URL = process.env.MAKE_OPINE_WEBHOOK_URL;
    if (MAKE_URL) {
      const mres = await fetch(MAKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: aUrl ? 'web' : 'text',
          instruction,
          url: aUrl || undefined,
          content: aContent || undefined,
          title: aTitle,
          model: conn.model || undefined,
          source_ids: conn.source_ids,
          filter_json: filterJson,
          namespace: conn.namespace,
          guides,
          references,
          citations: 'off',
          grounding,
          history: conversation ? conversation.split('\n') : []
        })
      });
      const text = await mres.text();
      if (!mres.ok) {
        console.error('[v1/opine] make relay', mres.status, text.slice(0, 300));
        return Response.json({ error: 'Critique service temporarily unavailable. Try again.' }, { status: 502, headers: cors });
      }
      let answer = text;
      try {
        const j = JSON.parse(text);
        if (j && typeof j === 'object' && 'answer' in j && typeof j.answer === 'string') answer = j.answer;
      } catch {
        /* plain-text answer */
      }
      return Response.json({ answer: stripCitations(answer), bank: conn.label }, { headers: cors });
    }

    // ── Fallback: run the opine orchestration in-code (when no Make webhook). ──
    let artifact: Artifact | null = null;
    if (hasArtifact) {
      let resolved = aContent;
      if (aContent.trim().length < 200 && aUrl) {
        const p = await fetchReadablePage(aUrl);
        if (p.ok && p.text && p.text.length > aContent.trim().length) resolved = p.text;
      }
      artifact = { content: resolved, title: aTitle, url: aUrl || undefined };
    }
    const result = await runOpine({
      instruction,
      namespace: conn.namespace,
      sourceIds: conn.source_ids,
      artifact,
      references,
      citations: 'off',
      grounding,
      guides,
      conversation
    });
    return Response.json({ answer: stripCitations(result.answer), bank: conn.label }, { headers: cors });
  } catch (e) {
    console.error('[v1/opine]', e);
    return Response.json(
      { error: 'Critique service temporarily unavailable. Try again.' },
      { status: 502, headers: cors }
    );
  }
}
