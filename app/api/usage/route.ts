import { auth, clerkClient } from '@clerk/nextjs/server';
import { nsForUser, memNsForUser } from '@/lib/rag/namespace';
import { readUsage, monthPeriod } from '@/lib/rag/metering';
import { scopeOf } from '@/lib/org-settings';

// STORAGE METERING (2026-07-04). Real usage straight from Pinecone's
// describe_index_stats — not the client-side chunk estimate. Every signed-in
// user sees THEIR OWN numbers (sources namespace + memory namespace); the
// owner additionally gets the per-namespace breakdown across all users, which
// is the metering basis for future limits/billing. Born from the incident
// where the org silently hit its 2 GB storage cap at ~500k banked vectors and
// every import bounced with a generic retry-storm.

export const runtime = 'nodejs';

const OWNER = (process.env.ALLOWED_EMAILS ?? 'tiosquareinc@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Measured 2026-07-04: the org hit Pinecone's 2 GB plan cap at ~502k vectors →
// ~4.3 KB/vector average (768 float32 dims + the chunk text in metadata).
// Pinecone's stats API reports counts, not bytes, so bytes shown are estimates.
const EST_BYTES_PER_VECTOR = 4300;

export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const host = process.env.PINECONE_HOST;
  const key = process.env.PINECONE_API_KEY;
  if (!host || !key)
    return Response.json({ error: 'Pinecone is not configured' }, { status: 503 });

  let stats: {
    totalVectorCount?: number;
    namespaces?: Record<string, { vectorCount?: number }>;
  };
  try {
    const r = await fetch(
      `https://${host.replace(/^https?:\/\//, '')}/describe_index_stats`,
      {
        method: 'POST',
        headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(15_000)
      }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    stats = await r.json();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'stats fetch failed';
    return Response.json({ error: `Could not read index stats: ${msg}` }, { status: 502 });
  }

  const namespaces = stats.namespaces ?? {};
  const count = (ns: string) => namespaces[ns]?.vectorCount ?? 0;
  const mine = count(nsForUser(userId)) + count(memNsForUser(userId));
  const total = stats.totalVectorCount ?? 0;

  const body: Record<string, unknown> = {
    vectors: mine,
    estBytes: mine * EST_BYTES_PER_VECTOR,
    totalVectors: total,
    totalEstBytes: total * EST_BYTES_PER_VECTOR,
    // OPS METERING (3.17): this month's counted usage for the caller's scope.
    month: monthPeriod(),
    questionsThisMonth: await readUsage(scopeOf(orgId, userId), 'questions', monthPeriod()),
    uploadsThisMonth: await readUsage(`user:${userId}`, 'uploads', monthPeriod())
  };

  // Owner-only: the metering table — every namespace with its user resolved to
  // an email where possible (legacy/system namespaces show as-is).
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(userId);
    const email = (
      u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      ''
    ).toLowerCase();
    if (OWNER.includes(email)) {
      const rows = await Promise.all(
        Object.entries(namespaces).map(async ([ns, v]) => {
          const m = /^u_(user_[A-Za-z0-9]+?)(__mem)?$/.exec(ns);
          let who = ns;
          if (m) {
            try {
              const owner = await client.users.getUser(m[1]);
              who =
                (owner.emailAddresses.find((e) => e.id === owner.primaryEmailAddressId)
                  ?.emailAddress ??
                  owner.emailAddresses[0]?.emailAddress ??
                  m[1]) + (m[2] ? ' (memory)' : '');
            } catch {
              who = m[1] + (m[2] ? ' (memory)' : '');
            }
          }
          const vectors = v.vectorCount ?? 0;
          return { namespace: ns, user: who, vectors, estBytes: vectors * EST_BYTES_PER_VECTOR };
        })
      );
      rows.sort((a, b) => b.vectors - a.vectors);
      body.breakdown = rows;
    }
  } catch {
    /* breakdown is best-effort — personal numbers still return */
  }

  return Response.json(body);
}
