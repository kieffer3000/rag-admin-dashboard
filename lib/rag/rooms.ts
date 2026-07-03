import 'server-only';
import { randomBytes } from 'crypto';
import { sql } from '@/lib/board-db';
import { listConnections, type ConnectionRow } from '@/lib/rag/connections';

// ---------------------------------------------------------------------------
// EMBEDDABLE ROOMS — a "Boardroom in an iframe".
//
// A room bundles N already-published Answers Banks (Connections) into one
// public, domain-locked embed. The customer pastes ONE <iframe> (served from
// dash.answersdoc.com); inside it, the widget fans a question out to each
// seated expert via the EXISTING per-Bank embed slug (same-origin → the public
// /api/v1 auth already trusts it). No secret keys in the page, no host-app code.
//
// Security model (identical to the single-Bank embed):
//   - The room stores only member CONNECTION IDS + its own allowed_origins.
//   - The widget page is served from our origin; its /api/v1 calls are
//     same-origin, so each member's public embed slug authorizes normally.
//   - Middleware frame-LOCKS /embed/room/<slug> to the room's allowed_origins
//     (see lib/rag/room-origins.ts) so a browser refuses to render it elsewhere.
// ---------------------------------------------------------------------------

export interface RoomRow {
  slug: string;
  scope: string;
  user_id: string;
  label: string;
  member_ids: string[];
  allowed_origins: string[];
  allow_table: boolean;
  created_at: string;
}

/** A seated expert as the widget needs it — label + its public embed slug. */
export interface RoomExpert {
  label: string;
  embedSlug: string;
}

let ensured = false;
async function ensureSchema() {
  if (!sql || ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS embed_rooms (
      slug text PRIMARY KEY,
      scope text NOT NULL,
      user_id text NOT NULL,
      label text NOT NULL DEFAULT 'Boardroom',
      member_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb,
      allow_table boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS embed_rooms_scope_idx ON embed_rooms (scope)`;
  ensured = true;
}

const newSlug = () => 'room_' + randomBytes(15).toString('base64url');

function normOrigin(s: string): string {
  let v = (s ?? '').trim().toLowerCase();
  if (!v) return '';
  if (!/^https?:\/\//.test(v)) v = 'https://' + v;
  try {
    return new URL(v).origin;
  } catch {
    return '';
  }
}

function rowOf(r: Record<string, unknown>): RoomRow {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? safeArr(v) : [];
  return {
    slug: String(r.slug),
    scope: String(r.scope),
    user_id: String(r.user_id),
    label: String(r.label ?? 'Boardroom'),
    member_ids: arr(r.member_ids),
    allowed_origins: arr(r.allowed_origins),
    allow_table: r.allow_table === true || r.allow_table === 't',
    created_at: String(r.created_at ?? '')
  };
}
function safeArr(s: string): string[] {
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

export async function createRoom(input: {
  scope: string;
  userId: string;
  label: string;
  memberIds: string[];
  allowedOrigins: string[];
  allowTable: boolean;
}): Promise<RoomRow | null> {
  if (!sql) return null;
  await ensureSchema();
  const slug = newSlug();
  const members = (input.memberIds ?? []).filter((m) => typeof m === 'string');
  const origins = Array.from(
    new Set((input.allowedOrigins ?? []).map(normOrigin).filter(Boolean))
  );
  await sql`
    INSERT INTO embed_rooms (slug, scope, user_id, label, member_ids, allowed_origins, allow_table)
    VALUES (${slug}, ${input.scope}, ${input.userId}, ${input.label || 'Boardroom'},
            ${JSON.stringify(members)}::jsonb, ${JSON.stringify(origins)}::jsonb, ${!!input.allowTable})
  `;
  const rows = await sql`SELECT * FROM embed_rooms WHERE slug=${slug}`;
  return rows[0] ? rowOf(rows[0]) : null;
}

export async function listRooms(scope: string): Promise<RoomRow[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql`SELECT * FROM embed_rooms WHERE scope=${scope} ORDER BY created_at DESC`;
  return rows.map(rowOf);
}

export async function deleteRoom(scope: string, slug: string): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`DELETE FROM embed_rooms WHERE scope=${scope} AND slug=${slug}`;
}

export async function getRoomBySlug(slug: string): Promise<RoomRow | null> {
  if (!sql || !slug) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM embed_rooms WHERE slug=${slug} LIMIT 1`;
  return rows[0] ? rowOf(rows[0]) : null;
}

/** Resolve a room to its seated experts (label + public embed slug), in the
 *  stored member order. Members without an embed slug (never got one) or that
 *  no longer exist are dropped — a room degrades gracefully. */
export async function roomExperts(room: RoomRow): Promise<RoomExpert[]> {
  const conns: ConnectionRow[] = await listConnections(room.scope);
  const byId = new Map(conns.map((c) => [c.id, c]));
  const out: RoomExpert[] = [];
  for (const id of room.member_ids) {
    const c = byId.get(id);
    if (c && c.embed_slug) out.push({ label: c.label || 'Expert', embedSlug: c.embed_slug });
  }
  return out;
}
