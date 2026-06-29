import { getConnectionByKey } from '@/lib/rag/connections';
import { relayPublicQuery } from '@/lib/rag/query-relay';

// PUBLIC, key-authed Q&A over one published Answers Bank. NOT Clerk-gated
// (see middleware isPublicRoute) — a per-Bank API key is the credential. The
// key resolves to a stored { namespace, source_ids } snapshot, so a key holder
// can only ever read that Bank's corpus, read-only. The Make webhook URL never
// leaves the server.

export const runtime = 'nodejs';
export const maxDuration = 60;

// Best-effort per-key throttle. In-memory, so it resets per serverless instance
// — a courtesy limit, not a hard security boundary (the key scope is the real
// boundary). 60 questions / minute / key.
const RATE = 60;
const WINDOW_MS = 60_000;
const buckets = new Map<string, { n: number; reset: number }>();
function rateLimited(id: string): boolean {
  const now = Date.now();
  const b = buckets.get(id);
  if (!b || now > b.reset) {
    buckets.set(id, { n: 1, reset: now + WINDOW_MS });
    return false;
  }
  b.n += 1;
  return b.n > RATE;
}

function selfOriginOf(req: Request): string {
  const host = req.headers.get('host') ?? '';
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}`.toLowerCase() : '';
}

/** Decide whether a browser request's Origin is allowed for this connection.
 *  - No Origin (server-to-server curl): allowed — the secret key is the credential.
 *  - Same-origin (the embed widget served from this app): always allowed.
 *  - Otherwise the Origin must be in the connection's allowlist.
 *  Returns the CORS headers + a boolean. */
function resolveCors(
  origin: string | null,
  selfOrigin: string,
  allowed: string[]
): { ok: boolean; headers: Record<string, string> } {
  const o = (origin ?? '').toLowerCase();
  let ok = true;
  let allowOrigin = '*';
  if (o) {
    if (o === selfOrigin || allowed.includes(o)) {
      allowOrigin = origin!;
    } else {
      ok = false;
      allowOrigin = 'null';
    }
  }
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    }
  };
}
const openCors = (origin: string | null) => resolveCors(origin, '', []).headers;

function keyFrom(req: Request, body: Record<string, unknown>): string {
  const auth = req.headers.get('authorization') ?? '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const x = req.headers.get('x-api-key');
  if (x) return x.trim();
  if (typeof body.key === 'string') return body.key.trim();
  return '';
}

export async function OPTIONS(req: Request) {
  // Preflight — reflect permissively; the actual GET/POST re-checks the Origin
  // against the resolved connection's allowlist.
  return new Response(null, { status: 204, headers: openCors(req.headers.get('origin')) });
}

// Lightweight public config for the embed widget (no question): the Bank's
// label, whether to show the speed picker, and the default speed.
export async function GET(req: Request) {
  const origin = req.headers.get('origin');
  const key = keyFrom(req, {});
  const conn = key ? await getConnectionByKey(key) : null;
  if (!conn) {
    return Response.json({ error: 'Invalid or revoked API key.' }, { status: 401, headers: openCors(origin) });
  }
  const { ok, headers } = resolveCors(origin, selfOriginOf(req), conn.allowed_origins);
  if (!ok) {
    return Response.json({ error: 'Origin not allowed for this key.' }, { status: 403, headers });
  }
  return Response.json(
    {
      bank: conn.label,
      allowSpeedChoice: conn.allow_speed_choice,
      defaultSpeed: conn.speed
    },
    { headers }
  );
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body ok */
  }

  const key = keyFrom(req, body);
  if (!key) {
    return Response.json(
      { error: 'Missing API key. Send Authorization: Bearer <key>.' },
      { status: 401, headers: openCors(origin) }
    );
  }

  const conn = await getConnectionByKey(key);
  if (!conn) {
    return Response.json(
      { error: 'Invalid or revoked API key.' },
      { status: 401, headers: openCors(origin) }
    );
  }

  // Origin lock — deny browser calls from a domain that isn't allowed (covers the
  // widget being lifted onto an unauthorized site, or the key used from another
  // origin's JS). Server-to-server calls (no Origin) pass — the key is the secret.
  const { ok: originOk, headers: cors } = resolveCors(
    origin,
    selfOriginOf(req),
    conn.allowed_origins
  );
  if (!originOk) {
    return Response.json(
      { error: 'This key is locked to another website and cannot be used from here.' },
      { status: 403, headers: cors }
    );
  }

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
    const conversationArr = Array.isArray(body.conversation) ? body.conversation : [];
    const conversation = conversationArr
      .map((t) => {
        const turn = t as { role?: string; content?: string };
        if (!turn || typeof turn.content !== 'string') return '';
        return `${turn.role === 'assistant' ? 'A' : 'Q'}: ${turn.content}`;
      })
      .filter(Boolean)
      .slice(-10)
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

    return Response.json(
      { answer: result.answer, citations: result.citations, bank: conn.label },
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
