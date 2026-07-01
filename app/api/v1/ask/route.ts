import { authorizeConnection, rateLimited, openCors } from '@/lib/rag/public-api';
import { relayPublicQuery } from '@/lib/rag/query-relay';

// PUBLIC, key-authed Q&A over one published Answers Bank. NOT Clerk-gated
// (see middleware isPublicRoute) — a per-Bank API key is the credential. The
// key resolves to a stored { namespace, source_ids } snapshot, so a key holder
// can only ever read that Bank's corpus, read-only. The Make webhook URL never
// leaves the server.

export const runtime = 'nodejs';
// RESEARCH mode's Make reasoning can run 60–180s — the same heavy path the in-app
// /api/query route already allows 180s for. At 60s the embed widget's Research
// requests were killed mid-flight (504 FUNCTION_INVOCATION_TIMEOUT) while Fast/
// Normal (well under 60s) succeeded. This is NOT a cross-site cookie issue: the
// widget is a public, NON-Clerk route authed by the embed slug (no cookies), so a
// 504 can only be a server timeout. Match the project Fluid ceiling (300s).
export const maxDuration = 300;

// Auth (key/slug), CORS, and per-key throttle are shared with /api/v1/opine —
// see lib/rag/public-api.ts.

export async function OPTIONS(req: Request) {
  // Preflight — reflect permissively; the actual GET/POST re-checks the Origin
  // against the resolved connection's allowlist.
  return new Response(null, { status: 204, headers: openCors(req.headers.get('origin')) });
}

// Lightweight public config for the embed widget (no question): the Bank's
// label, whether to show the speed picker, and the default speed.
export async function GET(req: Request) {
  const a = await authorizeConnection(req, {});
  if ('error' in a) {
    return Response.json({ error: a.error }, { status: a.status, headers: a.headers });
  }
  return Response.json(
    {
      bank: a.conn.label,
      allowSpeedChoice: a.conn.allow_speed_choice,
      defaultSpeed: a.conn.speed
    },
    { headers: a.headers }
  );
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
    return Response.json(
      { error: 'Rate limit exceeded — slow down.' },
      { status: 429, headers: cors }
    );
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    return Response.json(
      { error: 'A "question" string is required.' },
      { status: 400, headers: cors }
    );
  }
  if (conn.source_ids.length === 0) {
    return Response.json(
      { error: 'This connection has no wired sources. Re-publish the Answers Bank.' },
      { status: 409, headers: cors }
    );
  }

  try {
    // Preformat the recent conversation EXACTLY like the in-app brain
    // (/api/query): last 30 turns as "User:/Assistant:" lines, so Make's
    // follow-up expander resolves "explain further" against real context.
    const conversation = (Array.isArray(body.conversation) ? body.conversation : [])
      .filter(
        (t): t is { role?: string; content: string } =>
          !!t && typeof (t as { content?: unknown }).content === 'string' &&
          (t as { content: string }).content.trim().length > 0
      )
      .slice(-30)
      .map((t) => `${t.role === 'assistant' ? 'Assistant' : 'User'}: ${t.content}`)
      .join('\n');

    // Speed: locked to the connection's setting UNLESS the publisher allowed the
    // widget to choose — then honour a valid client-supplied speed (research can
    // cost more, so it's opt-in by the publisher).
    const reqSpeed = typeof body.speed === 'string' ? body.speed : '';
    const validSpeeds = ['fast', 'detailed', 'research'];
    const speed = (
      conn.allow_speed_choice && validSpeeds.includes(reqSpeed) ? reqSpeed : conn.speed
    ) as 'fast' | 'detailed' | 'research';

    const result = await relayPublicQuery({
      question,
      namespace: conn.namespace,
      sourceIds: conn.source_ids,
      answerMode: conn.answer_mode === 'hybrid' ? 'hybrid' : 'cited',
      model: conn.model,
      speed: speed ?? 'detailed',
      conversation
    });

    // Citations are intentionally NOT exposed via the public API — only the
    // answer text is returned to external callers / the embed widget.
    return Response.json(
      { answer: result.answer, bank: conn.label },
      { headers: cors }
    );
  } catch (e) {
    console.error('[v1/ask]', e);
    return Response.json(
      { error: 'Answer service temporarily unavailable. Try again.' },
      { status: 502, headers: cors }
    );
  }
}
