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

/** CORS headers for a given request origin against a connection's allowlist.
 *  Empty allowlist = open (`*`). Otherwise only echo an allowed origin. */
function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  let allowOrigin = '*';
  if (allowed.length > 0) {
    const o = (origin ?? '').toLowerCase();
    allowOrigin = o && allowed.includes(o) ? origin! : 'null';
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function keyFrom(req: Request, body: Record<string, unknown>): string {
  const auth = req.headers.get('authorization') ?? '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const x = req.headers.get('x-api-key');
  if (x) return x.trim();
  if (typeof body.key === 'string') return body.key.trim();
  return '';
}

export async function OPTIONS(req: Request) {
  // Preflight — we don't know the key's allowlist yet, so reflect permissively;
  // the actual POST re-checks against the resolved connection.
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get('origin'), [])
  });
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
      { status: 401, headers: corsHeaders(origin, []) }
    );
  }

  const conn = await getConnectionByKey(key);
  if (!conn) {
    return Response.json(
      { error: 'Invalid or revoked API key.' },
      { status: 401, headers: corsHeaders(origin, []) }
    );
  }

  const cors = corsHeaders(origin, conn.allowed_origins);
  // Origin lock: if the connection pins origins and this one isn't allowed, deny
  // (covers the embed widget being lifted onto an unauthorized site).
  if (conn.allowed_origins.length > 0 && cors['Access-Control-Allow-Origin'] === 'null') {
    return Response.json(
      { error: 'Origin not allowed for this key.' },
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

    const result = await relayPublicQuery({
      question,
      namespace: conn.namespace,
      sourceIds: conn.source_ids,
      answerMode: conn.answer_mode === 'hybrid' ? 'hybrid' : 'cited',
      model: conn.model,
      speed: (conn.speed as 'fast' | 'detailed' | 'research') ?? 'detailed',
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
