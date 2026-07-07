import 'server-only';
import { sql } from '@/lib/board-db';

// USAGE COUNTERS + GATES (Build 3.17). One tiny Postgres table holds every
// countable op: (scope, metric, period) → n. Increments happen at the few
// server chokepoints an op already passes through; the SAME chokepoint gates
// against the plan cap. Fail-OPEN everywhere: no DB / transient error must
// never block the owner or eat a customer's question — a lost count costs
// pennies, a false refusal costs trust.
//
// Metrics in use: `questions` (monthly, /api/query + /api/opine),
// `uploads` (monthly, visibility only), `public_answers` (DAILY, per
// connection — scope `conn:<id>`).

let ensured = false;

export async function ensureUsageSchema() {
  if (!sql || ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS usage_counters (
      scope text NOT NULL,
      metric text NOT NULL,
      period text NOT NULL,
      n bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (scope, metric, period)
    )
  `;
  ensured = true;
}

/** Current calendar month, e.g. "2026-07" (UTC — billing period boundary). */
export const monthPeriod = () => new Date().toISOString().slice(0, 7);
/** Current calendar day, e.g. "2026-07-06" (UTC). */
export const dayPeriod = () => new Date().toISOString().slice(0, 10);

/** Atomically add `by` and return the NEW total. 0 on any failure (fail-open —
 *  callers treat 0 as "couldn't count, allow"). */
export async function bumpUsage(
  scope: string,
  metric: string,
  period: string,
  by = 1
): Promise<number> {
  if (!sql) return 0;
  try {
    await ensureUsageSchema();
    const rows = await sql`
      INSERT INTO usage_counters (scope, metric, period, n, updated_at)
      VALUES (${scope}, ${metric}, ${period}, ${by}, now())
      ON CONFLICT (scope, metric, period)
      DO UPDATE SET n = usage_counters.n + ${by}, updated_at = now()
      RETURNING n`;
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

export async function readUsage(
  scope: string,
  metric: string,
  period: string
): Promise<number> {
  if (!sql) return 0;
  try {
    await ensureUsageSchema();
    const rows = await sql`
      SELECT n FROM usage_counters
      WHERE scope=${scope} AND metric=${metric} AND period=${period}`;
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Count the op AND check the cap in one call. `cap` Infinity/NaN = unlimited
 *  (not even counted — owners stay out of the table). `by` = credit cost of
 *  this op (research ask = 3, opine = 2, default 1). n===0 means the DB
 *  couldn't count → allow (fail-open). */
export async function gateUsage(
  scope: string,
  metric: string,
  period: string,
  cap: number,
  by = 1
): Promise<{ ok: boolean; n: number }> {
  if (!Number.isFinite(cap)) return { ok: true, n: 0 };
  const n = await bumpUsage(scope, metric, period, by);
  return { ok: n === 0 || n <= cap, n };
}

/** Live vector count of one Pinecone namespace (the storage gate's measure).
 *  null on any failure — callers treat null as "can't measure, allow". */
export async function namespaceVectorCount(namespace: string): Promise<number | null> {
  const rawHost = process.env.PINECONE_HOST;
  const key = process.env.PINECONE_API_KEY;
  if (!rawHost || !key) return null;
  const host = `https://${rawHost.replace(/^https?:\/\//, '')}`;
  try {
    const r = await fetch(`${host}/describe_index_stats`, {
      method: 'POST',
      headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10_000)
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Number(j?.namespaces?.[namespace]?.vectorCount ?? 0);
  } catch {
    return null;
  }
}
