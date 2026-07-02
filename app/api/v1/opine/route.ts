import { authorizeConnection, rateLimited, openCors } from '@/lib/rag/public-api';
import { runOpine, type Artifact } from '@/lib/rag/opine';
import { fetchReadablePage } from '@/lib/rag/web-extract';
import { longFetch, isRelayTimeout } from '@/lib/rag/long-fetch';

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
//             grounding?: 'cited'|'hybrid', conversation?|history?: [{role,content}],
//             citations?: 'on'|'off'  (or include_citations: true) — default OFF }
// Response: { answer, bank }  — plus { citations: [...] } when citations are ON
//           (opt-in; the Doctor/critique stage wants sourced notes, writing
//           stages want clean prose). (or { error })

export const runtime = 'nodejs';
// Opine's reasoning (in Make) can run LONG — a real full-doctrine critique
// MEASURED 5min, exactly at the old 300s wall (route died while the scenario
// finished fine). 800 = the Fluid ceiling; the relay fetch below uses a
// matched undici Agent (780s) because Node's global fetch dies at ~300s
// regardless of maxDuration.
export const maxDuration = 800;

const HISTORY_MAX = 30;

/** Citations OFF (default): drop <mark> highlights + numeric [n] footnote
 *  markers, leaving real bracketed text (e.g. [Free]) intact. */
function stripCitations(html: string): string {
  return (html ?? '')
    .replace(/<\/?mark[^>]*>/gi, '')
    .replace(/\s*\[\d+(?:\s*[,;–-]\s*\d+)*\](?:\s*\[\d+(?:\s*[,;–-]\s*\d+)*\])*/g, '')
    .trim();
}

/** Citations ON: keep the [n] footnote markers (they map to the citations
 *  array) but drop the raw <mark> highlight spans (in-app renderer only). */
function stripHighlights(html: string): string {
  return (html ?? '').replace(/<\/?mark[^>]*>/gi, '').trim();
}

interface OpineCitation {
  source_id: string;
  source_name?: string;
  snippet?: string;
  score?: number;
}

/** Pull a de-duped citations array out of Make's (varied) opine envelope. */
function parseCitations(obj: Record<string, unknown>): OpineCitation[] {
  let raw: Array<Record<string, unknown>> = [];
  const rc = obj.raw_citations;
  if (rc) {
    try {
      const parsed = typeof rc === 'string' ? JSON.parse(rc) : rc;
      if (Array.isArray(parsed)) raw = parsed as Array<Record<string, unknown>>;
    } catch {
      /* ignore malformed */
    }
  }
  if (raw.length === 0 && Array.isArray(obj.citations)) {
    raw = obj.citations as Array<Record<string, unknown>>;
  }
  const seen = new Set<string>();
  return raw
    .map((item) => {
      if (item.source_id) return item as unknown as OpineCitation;
      const meta = (item.metadata ?? {}) as Record<string, unknown>;
      return {
        score: item.score as number,
        source_id: meta.source_id as string,
        source_name: meta.source_name as string,
        snippet: (meta.text ?? meta.snippet ?? '') as string
      } as OpineCitation;
    })
    .filter((c) => {
      if (!c || !c.source_id) return false;
      const k = `${c.source_id}::${(c.snippet ?? '').trim().slice(0, 80)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);
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
  // Opt-in citations (default OFF): the Doctor/critique stage sends citations:'on'
  // so notes are sourced ("violates Kennedy's message-to-market match"); writing
  // stages leave it off for clean prose.
  const wantCitations = body.citations === 'on' || body.include_citations === true;
  const conversation = formatConversation(body);
  const filterJson = conn.source_ids.length
    ? JSON.stringify({ source_id: { $in: conn.source_ids } })
    : undefined;

  try {
    // ── Prod path: relay to the Make opine scenario (mirrors /api/opine). ──
    const MAKE_URL = process.env.MAKE_OPINE_WEBHOOK_URL;
    if (MAKE_URL) {
      // longFetch: matched undici set w/ 780s window — a long critique runs
      // past global fetch's ~300s default and the scenario COMPLETES; don't
      // abandon an answer Make is still writing.
      const mres = await longFetch(MAKE_URL, {
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
          citations: wantCitations ? 'on' : 'off',
          grounding,
          history: conversation ? conversation.split('\n') : []
        })
      });
      const text = await mres.text();
      if (!mres.ok) {
        console.error('[v1/opine] make relay', mres.status, text.slice(0, 300));
        // Distinct error for the orchestrator: the SCENARIO answered with an
        // error (retryable if 5xx). Surface Make's own {error,stage,detail}
        // body when the error-handler webhook responses are wired.
        let msg = 'The Bank’s reasoning scenario returned an error.';
        let detail: string | undefined = text.slice(0, 300) || undefined;
        try {
          const j = JSON.parse(text);
          if (j?.error) msg = j.stage ? `${j.error} (${j.stage})` : String(j.error);
          if (j?.detail) detail = String(j.detail).slice(0, 300);
        } catch { /* non-JSON body → keep snippet as detail */ }
        return Response.json(
          { error: msg, code: 'scenario_error', upstream_status: mres.status, detail },
          { status: 502, headers: cors }
        );
      }
      let answer = text;
      let parsed: Record<string, unknown> | null = null;
      try {
        const j = JSON.parse(text);
        if (j && typeof j === 'object') {
          parsed = j as Record<string, unknown>;
          if (typeof parsed.answer === 'string') answer = parsed.answer;
        }
      } catch {
        /* plain-text answer */
      }
      if (wantCitations) {
        return Response.json(
          { answer: stripHighlights(answer), bank: conn.label, citations: parsed ? parseCitations(parsed) : [] },
          { headers: cors }
        );
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
      citations: wantCitations ? 'on' : 'off',
      grounding,
      guides,
      conversation
    });
    if (wantCitations) {
      const citations: OpineCitation[] = result.pool
        .map((c) => ({ source_id: c.source_id, source_name: c.source_name, snippet: c.text, score: c.score }))
        .slice(0, 10);
      return Response.json({ answer: stripHighlights(result.answer), bank: conn.label, citations }, { headers: cors });
    }
    return Response.json({ answer: stripCitations(result.answer), bank: conn.label }, { headers: cors });
  } catch (e) {
    console.error('[v1/opine]', e);
    // Distinct errors so the orchestrator can choose retry-vs-wait:
    // relay_timeout = WE gave up waiting (the scenario may still finish —
    // don't hammer-retry; wait or split the artifact). engine_error =
    // network/in-code failure (safe to retry).
    if (isRelayTimeout(e)) {
      return Response.json(
        {
          error: 'The critique ran past the relay window (~13min). The scenario may still complete — wait before retrying, or split the artifact into smaller lanes.',
          code: 'relay_timeout'
        },
        { status: 504, headers: cors }
      );
    }
    return Response.json(
      { error: 'Critique service temporarily unavailable. Try again.', code: 'engine_error' },
      { status: 502, headers: cors }
    );
  }
}
