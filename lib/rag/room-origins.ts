import { neon } from '@neondatabase/serverless';

// EDGE-SAFE lookup for the middleware that frame-locks the ROOM embed widget.
// Mirror of lib/rag/embed-origins.ts but reads embed_rooms. Uses the neon fetch
// driver so it runs in Edge middleware. Never touches secret keys.

/** The origins a room embed slug is locked to, or null if unresolvable
 *  (no DB, unknown slug, transient error). Callers fail CLOSED on null. */
export async function allowedOriginsForRoomSlug(slug: string): Promise<string[] | null> {
  const url = process.env.POSTGRES_URL;
  if (!url || !slug) return null;
  try {
    const sql = neon(url);
    const rows = await sql`SELECT allowed_origins FROM embed_rooms WHERE slug=${slug} LIMIT 1`;
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
