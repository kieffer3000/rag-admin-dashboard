import { neon } from '@neondatabase/serverless';

// EDGE-SAFE lookup for the middleware that frame-locks the embed widget.
// Deliberately separate from lib/rag/connections.ts (which is `server-only` and
// uses node:crypto) — this one uses the neon fetch driver so it runs in the Edge
// middleware. It reads the allowed origins for a PUBLIC embed slug (the iframe
// path segment) — never the secret key.

/** The origins an embed slug is locked to, or null if it can't be resolved
 *  (no DB, unknown slug, or a transient error). Callers fail CLOSED on null. */
export async function allowedOriginsForSlug(slug: string): Promise<string[] | null> {
  const url = process.env.POSTGRES_URL;
  if (!url || !slug) return null;
  try {
    const sql = neon(url);
    const rows = await sql`SELECT allowed_origins FROM connections WHERE embed_slug=${slug} LIMIT 1`;
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
