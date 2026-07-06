import 'server-only';
import {
  getConnectionByKey,
  getConnectionBySlug,
  type ConnectionRow
} from '@/lib/rag/connections';

// ---------------------------------------------------------------------------
// Shared auth/CORS/throttle for the PUBLIC, key-authed Connections endpoints
// (/api/v1/ask and /api/v1/opine). A connection = one published Answers Bank +
// its API key; the key resolves server-side to { namespace, source_ids }, so a
// caller can only ever read/reason over that Bank's corpus. The Make webhook
// URLs never leave the server. Extracted so both endpoints stay identical.
// ---------------------------------------------------------------------------

// Best-effort per-key throttle. In-memory (resets per serverless instance) — a
// courtesy limit shared across the public endpoints, not a hard boundary (the
// key scope is the real boundary). 60 requests / minute / connection.
const RATE = 60;
const WINDOW_MS = 60_000;
const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimited(id: string): boolean {
  const now = Date.now();
  const b = buckets.get(id);
  if (!b || now > b.reset) {
    buckets.set(id, { n: 1, reset: now + WINDOW_MS });
    return false;
  }
  b.n += 1;
  return b.n > RATE;
}

// Per-IP throttle for the PUBLIC answer endpoints (3.17 abuse layer): a single
// bot hammering a public embed room burns house LLM money with no account
// attached. Best-effort in-memory like the per-key throttle above; the durable
// boundary is the per-connection DAILY budget in usage_counters. 20/min/IP.
const IP_RATE = 20;
const ipBuckets = new Map<string, { n: number; reset: number }>();
export function ipRateLimited(ip: string): boolean {
  if (!ip) return false;
  const now = Date.now();
  const b = ipBuckets.get(ip);
  if (!b || now > b.reset) {
    // Opportunistic sweep so the map can't grow unbounded under an IP flood.
    if (ipBuckets.size > 10_000)
      for (const [k, v] of ipBuckets) if (now > v.reset) ipBuckets.delete(k);
    ipBuckets.set(ip, { n: 1, reset: now + WINDOW_MS });
    return false;
  }
  b.n += 1;
  return b.n > IP_RATE;
}

/** First hop of x-forwarded-for = the client IP on Vercel. */
export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
}

function selfOriginOf(req: Request): string {
  const host = req.headers.get('host') ?? '';
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}`.toLowerCase() : '';
}

/** Decide whether a browser request's Origin is allowed for this connection.
 *  - No Origin (server-to-server curl): allowed — the secret key is the credential.
 *  - Same-origin (the embed widget served from this app): always allowed.
 *  - Otherwise the Origin must be in the connection's allowlist. */
export function resolveCors(
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
export const openCors = (origin: string | null) =>
  resolveCors(origin, '', []).headers;

function keyFrom(req: Request, body: Record<string, unknown>): string {
  const auth = req.headers.get('authorization') ?? '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const x = req.headers.get('x-api-key');
  if (x) return x.trim();
  if (typeof body.key === 'string') return body.key.trim();
  return '';
}

function slugFrom(req: Request, body: Record<string, unknown>): string {
  const h = req.headers.get('x-embed-id');
  if (h) return h.trim();
  if (typeof body.embedId === 'string') return body.embedId.trim();
  return '';
}

/** Resolve the caller's credential to a connection.
 *  - PUBLIC embed slug (x-embed-id, used by the widget): only honoured from the
 *    widget's OWN origin (same-origin). Never carries the secret key.
 *  - SECRET key (Bearer): REST. Browser cross-origin must match the allowlist;
 *    server-to-server (no Origin) passes — the key is the secret.
 *  Returns { conn, headers } on success, or { error, status, headers }. */
export async function authorizeConnection(
  req: Request,
  body: Record<string, unknown>
): Promise<
  | { conn: ConnectionRow; headers: Record<string, string> }
  | { error: string; status: number; headers: Record<string, string> }
> {
  const origin = req.headers.get('origin');
  const self = selfOriginOf(req);
  const slug = slugFrom(req, body);

  if (slug) {
    const conn = await getConnectionBySlug(slug);
    if (!conn) return { error: 'Unknown embed.', status: 401, headers: openCors(origin) };
    const o = (origin ?? '').toLowerCase();
    const okOrigin = !o || (!!self && o === self);
    if (!okOrigin) {
      return {
        error: 'This widget can only be used where it is embedded.',
        status: 403,
        headers: resolveCors(origin, self, []).headers
      };
    }
    return { conn, headers: resolveCors(origin, self, []).headers };
  }

  const key = keyFrom(req, body);
  if (!key) {
    return {
      error:
        'Missing credential. Send Authorization: Bearer <key> (REST) or x-embed-id (widget).',
      status: 401,
      headers: openCors(origin)
    };
  }
  const conn = await getConnectionByKey(key);
  if (!conn) return { error: 'Invalid or revoked API key.', status: 401, headers: openCors(origin) };

  const { ok, headers } = resolveCors(origin, self, conn.allowed_origins);
  if (!ok) {
    return {
      error: 'This key is locked to another website and cannot be used from here.',
      status: 403,
      headers
    };
  }
  return { conn, headers };
}

export type { ConnectionRow };
