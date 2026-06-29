import { neon } from '@neondatabase/serverless';

// EDGE-SAFE lookup for the middleware that frame-locks the embed widget.
// Deliberately separate from lib/rag/connections.ts (which is `server-only` and
// uses node:crypto) — this one uses Web Crypto + the neon fetch driver so it
// runs in the Edge middleware. It only reads a key's allowed origins.

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The origins a connection key is locked to, or null if it can't be resolved
 *  (no DB, unknown key, or a transient error). Callers fail CLOSED on null. */
export async function allowedOriginsForKey(key: string): Promise<string[] | null> {
  const url = process.env.POSTGRES_URL;
  if (!url || !key) return null;
  try {
    const hash = await sha256Hex(key);
    const sql = neon(url);
    const rows = await sql`SELECT allowed_origins FROM connections WHERE key_hash=${hash} LIMIT 1`;
    if (!rows[0]) return null;
    const v = (rows[0] as { allowed_origins: unknown }).allowed_origins;
    if (Array.isArray(v)) return v as string[];
    if (typeof v === 'string') {
      try {
        const p = JSON.parse(v);
        return Array.isArray(p) ? (p as string[]) : [];
      } catch {
        return [];
      }
    }
    return [];
  } catch {
    return null;
  }
}
