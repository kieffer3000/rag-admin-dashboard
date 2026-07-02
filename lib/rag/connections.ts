import 'server-only';
import { createHash, randomBytes } from 'crypto';
import { sql } from '@/lib/board-db';

// ---------------------------------------------------------------------------
// CONNECTIONS — publish an Answers Bank as an external, key-authed Q&A endpoint.
//
// A connection = a saved snapshot of { namespace, source_ids[], answer_mode,
// model } + an API key. External dashboards (or the embed widget) call
// /api/v1/ask with the key; it relays to the SAME Make query scenario, so
// answers stay grounded + cited. The key is shown ONCE at creation; we store
// only its sha256 hash. namespace is derived server-side from the owner — never
// trusted from a key holder, so a key can only ever read its own corpus.
// ---------------------------------------------------------------------------

export interface ConnectionRow {
  id: string;
  scope: string;
  user_id: string;
  label: string;
  namespace: string;
  source_ids: string[];
  answer_mode: string;
  model: string;
  speed: string;
  /** When true the embed widget shows a Fast/Normal/Research picker; otherwise
   *  it's locked to `speed`. */
  allow_speed_choice: boolean;
  allowed_origins: string[];
  key_prefix: string;
  /** PUBLIC, non-secret id used in the embed iframe URL. Safe to expose: it only
   *  works inside the widget, which is frame-locked to allowed_origins. The
   *  secret API key is never put in a URL. */
  embed_slug: string;
  /** Board node id of the Bank this connection was published from + its
   *  project — the link AUTO-SYNC uses to follow the Bank's live wiring.
   *  Null on legacy rows until the first Re-sync stamps them. */
  bank_node_id: string | null;
  project_id: string | null;
  created_at: string;
  last_used_at: string | null;
  calls: number;
}

let ensured = false;
async function ensureSchema() {
  if (!sql || ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS connections (
      id text PRIMARY KEY,
      scope text NOT NULL,
      user_id text NOT NULL,
      label text NOT NULL DEFAULT 'Untitled',
      namespace text NOT NULL,
      source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      answer_mode text NOT NULL DEFAULT 'cited',
      model text NOT NULL DEFAULT '',
      speed text NOT NULL DEFAULT 'detailed',
      allow_speed_choice boolean NOT NULL DEFAULT false,
      allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb,
      key_hash text NOT NULL,
      key_prefix text NOT NULL,
      embed_slug text,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      calls integer NOT NULL DEFAULT 0
    )
  `;
  // Idempotent adds for tables created before these columns existed.
  await sql`ALTER TABLE connections ADD COLUMN IF NOT EXISTS allow_speed_choice boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE connections ADD COLUMN IF NOT EXISTS embed_slug text`;
  await sql`ALTER TABLE connections ADD COLUMN IF NOT EXISTS bank_node_id text`;
  await sql`ALTER TABLE connections ADD COLUMN IF NOT EXISTS project_id text`;
  await sql`CREATE INDEX IF NOT EXISTS connections_key_hash_idx ON connections (key_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS connections_embed_slug_idx ON connections (embed_slug)`;
  await sql`CREATE INDEX IF NOT EXISTS connections_scope_idx ON connections (scope)`;
  ensured = true;
}

/** Normalize a user-typed website to a strict browser origin (scheme://host[:port]),
 *  defaulting to https. Returns '' if it can't be parsed. */
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

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
const newId = () => 'conn_' + randomBytes(9).toString('base64url');
/** Public, non-secret embed id (goes in the iframe URL). */
const newSlug = () => 'emb_' + randomBytes(18).toString('base64url');

/** A fresh, unguessable key. Shown to the owner ONCE; only its hash is stored. */
function newKey(): { key: string; prefix: string } {
  const body = randomBytes(24).toString('base64url');
  const key = `ad_live_${body}`;
  // A short, safe-to-display fingerprint for the management UI.
  return { key, prefix: `ad_live_…${body.slice(-4)}` };
}

export interface CreateConnectionInput {
  scope: string;
  userId: string;
  label: string;
  namespace: string;
  sourceIds: string[];
  answerMode?: string;
  model?: string;
  speed?: string;
  allowSpeedChoice?: boolean;
  allowedOrigins?: string[];
  /** Bank node + project link for auto-sync. */
  bankNodeId?: string;
  projectId?: string;
}

/** Create a connection and return the plaintext key ONCE (never stored). */
export async function createConnection(
  input: CreateConnectionInput
): Promise<{ row: ConnectionRow; key: string } | null> {
  if (!sql) return null;
  await ensureSchema();
  const id = newId();
  const slug = newSlug();
  const { key, prefix } = newKey();
  const sourceIds = (input.sourceIds ?? []).filter((s) => typeof s === 'string');
  const origins = Array.from(
    new Set((input.allowedOrigins ?? []).map(normOrigin).filter(Boolean))
  );
  const answerMode = input.answerMode === 'hybrid' ? 'hybrid' : 'cited';
  const speed =
    input.speed === 'fast' || input.speed === 'research' ? input.speed : 'detailed';
  const allowSpeedChoice = !!input.allowSpeedChoice;
  await sql`
    INSERT INTO connections
      (id, scope, user_id, label, namespace, source_ids, answer_mode, model, speed, allow_speed_choice, allowed_origins, key_hash, key_prefix, embed_slug, bank_node_id, project_id)
    VALUES
      (${id}, ${input.scope}, ${input.userId}, ${input.label || 'Untitled'},
       ${input.namespace}, ${JSON.stringify(sourceIds)}::jsonb, ${answerMode},
       ${input.model ?? ''}, ${speed}, ${allowSpeedChoice}, ${JSON.stringify(origins)}::jsonb,
       ${hashKey(key)}, ${prefix}, ${slug}, ${input.bankNodeId ?? null}, ${input.projectId ?? null})
  `;
  const rows = await sql`SELECT * FROM connections WHERE id=${id}`;
  return { row: rowOf(rows[0]), key };
}

/** All connections for a scope (owner view — never includes the key). */
export async function listConnections(scope: string): Promise<ConnectionRow[]> {
  if (!sql) return [];
  await ensureSchema();
  const rows = await sql`
    SELECT * FROM connections WHERE scope=${scope} ORDER BY created_at DESC
  `;
  return rows.map(rowOf);
}

/** Delete a connection (revoke the key). Scoped so a user can only delete theirs. */
export async function deleteConnection(scope: string, id: string): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  await sql`DELETE FROM connections WHERE scope=${scope} AND id=${id}`;
}

/** Re-snapshot a connection's wired sources / settings (when the Bank changes). */
export async function updateConnectionSources(
  scope: string,
  id: string,
  patch: { sourceIds?: string[]; answerMode?: string; model?: string; speed?: string; allowSpeedChoice?: boolean; label?: string; allowedOrigins?: string[]; bankNodeId?: string; projectId?: string }
): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  const existing = await sql`SELECT * FROM connections WHERE scope=${scope} AND id=${id}`;
  if (!existing[0]) return;
  const cur = rowOf(existing[0]);
  const sourceIds = patch.sourceIds ?? cur.source_ids;
  const answerMode = (patch.answerMode ?? cur.answer_mode) === 'hybrid' ? 'hybrid' : 'cited';
  const origins = patch.allowedOrigins
    ? Array.from(new Set(patch.allowedOrigins.map(normOrigin).filter(Boolean)))
    : cur.allowed_origins;
  const allowSpeedChoice =
    patch.allowSpeedChoice === undefined ? cur.allow_speed_choice : !!patch.allowSpeedChoice;
  await sql`
    UPDATE connections SET
      source_ids=${JSON.stringify(sourceIds)}::jsonb,
      answer_mode=${answerMode},
      model=${patch.model ?? cur.model},
      speed=${patch.speed ?? cur.speed},
      allow_speed_choice=${allowSpeedChoice},
      label=${patch.label ?? cur.label},
      allowed_origins=${JSON.stringify(origins)}::jsonb,
      bank_node_id=${patch.bankNodeId ?? cur.bank_node_id},
      project_id=${patch.projectId ?? cur.project_id}
    WHERE scope=${scope} AND id=${id}
  `;
}

/** Resolve a presented API key → its connection (for the public endpoint).
 *  Bumps usage counters. Returns null if the key is unknown. */
export async function getConnectionByKey(key: string): Promise<ConnectionRow | null> {
  if (!sql || !key) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM connections WHERE key_hash=${hashKey(key)} LIMIT 1`;
  if (!rows[0]) return null;
  const row = rowOf(rows[0]);
  // Best-effort usage bump (don't block the answer on it).
  void sql`UPDATE connections SET calls=calls+1, last_used_at=now() WHERE id=${row.id}`;
  return row;
}

/** Resolve a PUBLIC embed slug → its connection (for the widget). The slug is
 *  not a secret; its safety comes from the widget being frame-locked + the
 *  endpoint only honouring a slug from the widget's own origin. */
export async function getConnectionBySlug(slug: string): Promise<ConnectionRow | null> {
  if (!sql || !slug) return null;
  await ensureSchema();
  const rows = await sql`SELECT * FROM connections WHERE embed_slug=${slug} LIMIT 1`;
  if (!rows[0]) return null;
  const row = rowOf(rows[0]);
  void sql`UPDATE connections SET calls=calls+1, last_used_at=now() WHERE id=${row.id}`;
  return row;
}

function rowOf(r: Record<string, unknown>): ConnectionRow {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? safeArr(v) : [];
  return {
    id: String(r.id),
    scope: String(r.scope),
    user_id: String(r.user_id),
    label: String(r.label ?? ''),
    namespace: String(r.namespace),
    source_ids: arr(r.source_ids),
    answer_mode: String(r.answer_mode ?? 'cited'),
    model: String(r.model ?? ''),
    speed: String(r.speed ?? 'detailed'),
    allow_speed_choice: r.allow_speed_choice === true || r.allow_speed_choice === 't',
    allowed_origins: arr(r.allowed_origins),
    key_prefix: String(r.key_prefix ?? ''),
    embed_slug: String(r.embed_slug ?? ''),
    bank_node_id: r.bank_node_id ? String(r.bank_node_id) : null,
    project_id: r.project_id ? String(r.project_id) : null,
    created_at: String(r.created_at ?? ''),
    last_used_at: r.last_used_at ? String(r.last_used_at) : null,
    calls: Number(r.calls ?? 0)
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
