import { authorizeConnection, rateLimited, openCors } from '@/lib/rag/public-api';
import { doctrineFor } from '@/lib/rag/doctrines';
import { relayPublicQuery } from '@/lib/rag/query-relay';
import { isRelayTimeout } from '@/lib/rag/long-fetch';

// PUBLIC, key-authed Q&A over one published Answers Bank. NOT Clerk-gated
// (see middleware isPublicRoute) — a per-Bank API key is the credential. The
// key resolves to a stored { namespace, source_ids } snapshot, so a key holder
// can only ever read that Bank's corpus, read-only. The Make webhook URL never
// leaves the server.

export const runtime = 'nodejs';
// RESEARCH mode's Make reasoning can run long — a real run MEASURED 5min,
// exactly at the old 300s wall. 800 = the Fluid ceiling; the relay itself uses
// a matched undici Agent (780s window, lib/rag/long-fetch.ts) because Node's
// global fetch dies at ~300s regardless of maxDuration. (History: 60s killed
// widget Research mid-flight; 300s killed long critiques the same way.)
export const maxDuration = 800;

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

    // DOCTRINE-ON-BANK (Boardroom item 1): the Bank's stored doctrine rides
    // every keyed ask too — the expert answers with its judgment, not just
    // its library. Legacy connections without a bank_node_id stamp skip this.
    const doctrine = await doctrineFor(conn.scope, conn.project_id, conn.bank_node_id);

    const result = await relayPublicQuery({
      question,
      namespace: conn.namespace,
      sourceIds: conn.source_ids,
      answerMode: conn.answer_mode === 'hybrid' ? 'hybrid' : 'cited',
      model: conn.model,
      speed: speed ?? 'detailed',
      conversation,
      guides: doctrine ? [doctrine] : []
    });

    // Citations are intentionally NOT exposed via the public API — only the
    // answer text is returned to external callers / the embed widget.
    return Response.json(
      { answer: result.answer, bank: conn.label },
      { headers: cors }
    );
  } catch (e) {
    console.error('[v1/ask]', e);
    // Distinct errors so the orchestrator can choose retry-vs-wait (mirrors
    // /api/v1/opine): relay_timeout = we gave up waiting; engine_error = retry.
    if (isRelayTimeout(e)) {
      return Response.json(
        {
          error: 'The answer ran past the relay window (~13min). The scenario may still complete — wait before retrying.',
          code: 'relay_timeout'
        },
        { status: 504, headers: cors }
      );
    }
    return Response.json(
      { error: 'Answer service temporarily unavailable. Try again.', code: 'engine_error' },
      { status: 502, headers: cors }
    );
  }
}
