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
  allowed_origins: string[];
  key_prefix: string;
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
      allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb,
      key_hash text NOT NULL,
      key_prefix text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      calls integer NOT NULL DEFAULT 0
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS connections_key_hash_idx ON connections (key_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS connections_scope_idx ON connections (scope)`;
  ensured = true;
}

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
const newId = () => 'conn_' + randomBytes(9).toString('base64url');

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
  allowedOrigins?: string[];
}

/** Create a connection and return the plaintext key ONCE (never stored). */
export async function createConnection(
  input: CreateConnectionInput
): Promise<{ row: ConnectionRow; key: string } | null> {
  if (!sql) return null;
  await ensureSchema();
  const id = newId();
  const { key, prefix } = newKey();
  const sourceIds = (input.sourceIds ?? []).filter((s) => typeof s === 'string');
  const origins = (input.allowedOrigins ?? [])
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);
  const answerMode = input.answerMode === 'hybrid' ? 'hybrid' : 'cited';
  const speed =
    input.speed === 'fast' || input.speed === 'research' ? input.speed : 'detailed';
  await sql`
    INSERT INTO connections
      (id, scope, user_id, label, namespace, source_ids, answer_mode, model, speed, allowed_origins, key_hash, key_prefix)
    VALUES
      (${id}, ${input.scope}, ${input.userId}, ${input.label || 'Untitled'},
       ${input.namespace}, ${JSON.stringify(sourceIds)}::jsonb, ${answerMode},
       ${input.model ?? ''}, ${speed}, ${JSON.stringify(origins)}::jsonb,
       ${hashKey(key)}, ${prefix})
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
  patch: { sourceIds?: string[]; answerMode?: string; model?: string; speed?: string; label?: string; allowedOrigins?: string[] }
): Promise<void> {
  if (!sql) return;
  await ensureSchema();
  const existing = await sql`SELECT * FROM connections WHERE scope=${scope} AND id=${id}`;
  if (!existing[0]) return;
  const cur = rowOf(existing[0]);
  const sourceIds = patch.sourceIds ?? cur.source_ids;
  const answerMode = (patch.answerMode ?? cur.answer_mode) === 'hybrid' ? 'hybrid' : 'cited';
  const origins = patch.allowedOrigins ?? cur.allowed_origins;
  await sql`
    UPDATE connections SET
      source_ids=${JSON.stringify(sourceIds)}::jsonb,
      answer_mode=${answerMode},
      model=${patch.model ?? cur.model},
      speed=${patch.speed ?? cur.speed},
      label=${patch.label ?? cur.label},
      allowed_origins=${JSON.stringify(origins)}::jsonb
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
    allowed_origins: arr(r.allowed_origins),
    key_prefix: String(r.key_prefix ?? ''),
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
