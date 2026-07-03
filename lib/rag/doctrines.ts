import 'server-only';
import { sql } from '@/lib/board-db';

// DOCTRINE-ON-BANK — Boardroom build order item 1 (BOARDROOM_BRIEF.md §2.2.4).
//
// A doctrine is the Bank's judgment, distilled: a one-page rubric injected as
// guides[] on EVERY call to that Bank — in-app chat, research mode, and the
// public /api/v1 endpoints. Without it a Bank is a search engine; with it the
// Bank has opinions. Until now doctrines lived in the CALLING app (cinefable's
// doctrines.ts shipped them per-call); storing them on the Bank itself means
// any client — the Boardroom, the Writer's Room, whatever's next — gets
// doctrine-armed experts for free.
//
// Versioned + changelogged, because the refine loop ("critique this rubric
// against your source material") bumps versions as the sources correct the
// rules — that self-correction is what separates "sounds like Kennedy" from
// "judges like Kennedy".

export interface DoctrineRecord {
  doctrine: string;
  version: number;
  updated_at: string | null;
  log: Array<{ v: number; at: string; note: string }>;
}

const EMPTY: DoctrineRecord = { doctrine: '', version: 0, updated_at: null, log: [] };

let ensured = false;
export async function ensureDoctrinesSchema() {
  if (!sql || ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS bank_doctrines (
      scope text NOT NULL,
      project_id text NOT NULL,
      bank_node_id text NOT NULL,
      user_id text,
      doctrine text NOT NULL DEFAULT '',
      version integer NOT NULL DEFAULT 0,
      log jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (scope, project_id, bank_node_id)
    )
  `;
  ensured = true;
}

export async function getDoctrine(
  scope: string,
  projectId: string,
  bankNodeId: string
): Promise<DoctrineRecord> {
  if (!sql || !projectId || !bankNodeId) return EMPTY;
  await ensureDoctrinesSchema();
  const rows = await sql`
    SELECT doctrine, version, updated_at, log FROM bank_doctrines
    WHERE scope=${scope} AND project_id=${projectId} AND bank_node_id=${bankNodeId}`;
  if (!rows[0]) return EMPTY;
  return {
    doctrine: String(rows[0].doctrine ?? ''),
    version: Number(rows[0].version ?? 0),
    updated_at: rows[0].updated_at ? String(rows[0].updated_at) : null,
    log: Array.isArray(rows[0].log) ? rows[0].log : []
  };
}

/** Save a doctrine — version bumps on every save, note lands in the changelog
 *  (trimmed to the newest 30 entries). Saving an EMPTY doctrine is allowed
 *  (that's how you retire one) and is recorded like any other version. */
export async function upsertDoctrine(
  scope: string,
  userId: string,
  projectId: string,
  bankNodeId: string,
  doctrine: string,
  note: string
): Promise<DoctrineRecord> {
  if (!sql) return EMPTY;
  await ensureDoctrinesSchema();
  const cur = await getDoctrine(scope, projectId, bankNodeId);
  const version = cur.version + 1;
  const entry = {
    v: version,
    at: new Date().toISOString(),
    note: (note || (cur.version === 0 ? 'created' : 'edited')).slice(0, 300)
  };
  const log = [entry, ...cur.log].slice(0, 30);
  await sql`
    INSERT INTO bank_doctrines (scope, project_id, bank_node_id, user_id, doctrine, version, log, updated_at)
    VALUES (${scope}, ${projectId}, ${bankNodeId}, ${userId}, ${doctrine}, ${version},
            ${JSON.stringify(log)}::jsonb, now())
    ON CONFLICT (scope, project_id, bank_node_id)
    DO UPDATE SET doctrine=EXCLUDED.doctrine, version=EXCLUDED.version,
                  log=EXCLUDED.log, user_id=EXCLUDED.user_id, updated_at=now()`;
  return { doctrine, version, updated_at: entry.at, log };
}

/** Prepend a stored doctrine to a call's guides. No-ops when the doctrine is
 *  empty or the caller already ships the same text per-call (the Writer's Room
 *  does today) — never inject the same rubric twice. */
export function injectDoctrine(guides: string[], doctrine: string): string[] {
  const d = (doctrine ?? '').trim();
  if (!d) return guides;
  if (guides.some((g) => g.trim() === d)) return guides;
  return [d, ...guides];
}

/** Best-effort doctrine fetch for an answer path — a doctrine lookup hiccup
 *  must never fail the answer itself. */
export async function doctrineFor(
  scope: string,
  projectId: string | null | undefined,
  bankNodeId: string | null | undefined
): Promise<string> {
  try {
    if (!projectId || !bankNodeId) return '';
    return (await getDoctrine(scope, projectId, bankNodeId)).doctrine;
  } catch {
    return '';
  }
}
