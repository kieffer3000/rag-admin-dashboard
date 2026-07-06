import 'server-only';
import { clerkClient } from '@clerk/nextjs/server';

// PLAN CAPS (Build 3.17). Billing philosophy (journal 2026-07-06): bill in APP
// units, never vendor units. Three resource classes, each capped AT the
// resource: LLM spend (per-scope provisioned OpenRouter sub-key — see
// openrouter-provision.ts), storage (Pinecone namespace vector count, gated at
// ingest), ops (questions/month, counted in usage_counters — see metering.ts).
//
// Owners (ALLOWED_EMAILS) are never capped. Plan slugs match the middleware's
// Clerk billing plans (`pro` individual / `team` org). `free` exists only as a
// belt-and-braces default — the middleware already 402s unsubscribed users
// when BILLING_OPEN is on, and blocks them entirely when it's off.

export type PlanSlug = 'owner' | 'team' | 'pro' | 'free';

export interface PlanCaps {
  /** /api/query + /api/opine calls per month (usage_counters `questions`). */
  questionsPerMonth: number;
  /** Max vectors banked in the user's Pinecone namespace (storage gate). */
  vectorsMax: number;
  /** Public embed/API answers per day, PER CONNECTION (usage_counters). */
  publicAnswersPerDay: number;
  /** Monthly USD ceiling for the scope's managed OpenRouter sub-key. 0 = don't
   *  mint one (owner rides the house key uncapped). */
  managedLlmUsdPerMonth: number;
}

export const PLAN_CAPS: Record<PlanSlug, PlanCaps> = {
  owner: {
    questionsPerMonth: Infinity,
    vectorsMax: Infinity,
    publicAnswersPerDay: Infinity,
    managedLlmUsdPerMonth: 0
  },
  team: {
    questionsPerMonth: 10_000,
    vectorsMax: 2_000_000,
    publicAnswersPerDay: 2_000,
    managedLlmUsdPerMonth: 40
  },
  pro: {
    questionsPerMonth: 2_000,
    vectorsMax: 250_000,
    publicAnswersPerDay: 500,
    managedLlmUsdPerMonth: 10
  },
  free: {
    questionsPerMonth: 50,
    vectorsMax: 5_000,
    publicAnswersPerDay: 50,
    managedLlmUsdPerMonth: 1
  }
};

// Same default list as middleware.ts — keep in sync (both read ALLOWED_EMAILS).
const OWNER_EMAILS = (
  process.env.ALLOWED_EMAILS ??
  'tiosquareinc@gmail.com,nc@tiosquare.com,ni@tiosquare.com,unixtech7@gmail.com'
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// Email lookups hit Clerk — cache per user so a busy session doesn't pay the
// round-trip on every question. (The middleware already does its own lookup;
// this cache is route-side only.)
const emailCache = new Map<string, { email: string; exp: number }>();
const EMAIL_TTL_MS = 10 * 60_000;

async function emailOf(userId: string): Promise<string> {
  const hit = emailCache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.email;
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(userId);
    const email = (
      u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      ''
    ).toLowerCase();
    emailCache.set(userId, { email, exp: Date.now() + EMAIL_TTL_MS });
    return email;
  } catch {
    return ''; // transient Clerk error → not owner, plans still resolve below
  }
}

/** Resolve the caller's plan. `has` is Clerk's auth() plan checker (optional —
 *  public paths don't have one). Fail-open toward the HIGHER tier only for the
 *  owner check's transient errors; unknown users resolve to `free`. */
export async function resolvePlan(
  userId: string,
  has?: (q: { plan: string }) => boolean
): Promise<{ slug: PlanSlug; caps: PlanCaps }> {
  const email = await emailOf(userId);
  if (email && OWNER_EMAILS.includes(email)) {
    return { slug: 'owner', caps: PLAN_CAPS.owner };
  }
  try {
    if (has?.({ plan: 'team' })) return { slug: 'team', caps: PLAN_CAPS.team };
    if (has?.({ plan: 'pro' })) return { slug: 'pro', caps: PLAN_CAPS.pro };
  } catch {
    /* fall through */
  }
  return { slug: 'free', caps: PLAN_CAPS.free };
}
