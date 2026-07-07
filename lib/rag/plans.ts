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

export type PlanSlug = 'owner' | 'team' | 'pro' | 'starter' | 'free';

export interface PlanCaps {
  /** Question CREDITS per month (usage_counters `questions`). Costs: normal
   *  ask = 1, research ask = 3, opine = 2 (heavier models + more Make ops). */
  questionsPerMonth: number;
  /** Max vectors banked in the user's Pinecone namespace (storage gate).
   *  Conversion (MEASURED 2026-07-04): ~4.3 KB/vector → 1M vectors ≈ 4.3 GB. */
  vectorsMax: number;
  /** Document uploads per month (gated at the ingest routes). */
  uploadsPerMonth: number;
  /** Projects allotted (UX guardrail — projects are architecturally free; not
   *  yet enforced server-side, displayed as the plan promise). */
  projectsMax: number;
  /** Public embed/API answers per day, PER CONNECTION (usage_counters). */
  publicAnswersPerDay: number;
  /** Monthly USD ceiling for the scope's managed OpenRouter sub-key. 0 = don't
   *  mint one (owner rides the house key uncapped). */
  managedLlmUsdPerMonth: number;
}

/** BYOK doubles question credits: the LLM (the dominant variable cost) moves
 *  to the customer's own OpenRouter account, so our per-question COGS drops
 *  ~60% (Make ops + Pinecone remain). Applied at the question gates. */
export const BYOK_QUESTION_MULTIPLIER = 2;

// PRICED 2026-07-06 from live vendor pages (journal has the full math):
// per-question COGS ≈ $0.03 managed (Make ~10 ops ≈ $0.012 + Gemini-Flash-class
// LLM ≈ $0.01-0.02 + Pinecone query ≈ negligible), ≈ $0.013 BYOK; indexing ≈
// $0.20/avg book (embed $0.20/M tok + WUs + summary); storage ≈ $1.42 per 1M
// vectors/mo. Caps sized for 80-90% gross margin at EXPECTED (~35% of cap)
// usage. Suggested prices: starter $12 / pro $29 / team $149 (5 seats) —
// configure in the Clerk billing dashboard.
//
// SIZING RULE (3.25→3.26): customers ONLY ever see credits — the dollar cap
// is internal and must NEVER bind a legitimate month. Sized at the WORST
// legitimate mix (every credit spent on research, the priciest lane at
// ~$0.023/credit with today's engine defaults) + ~10% headroom:
//   cap = questionsPerMonth × $0.023 × 1.1
// Per-ask LLM COGS (live Gemini prices 2026-07-06): fast ≈ $0.004 · normal ≈
// $0.008 · opine ≈ $0.03 (2 cr) · research ≈ $0.07 (3 cr). The model picker is
// removed (3.13), so WE control these ceilings — revisit if defaults change.
export const PLAN_CAPS: Record<PlanSlug, PlanCaps> = {
  owner: {
    questionsPerMonth: Infinity,
    vectorsMax: Infinity,
    uploadsPerMonth: Infinity,
    projectsMax: Infinity,
    publicAnswersPerDay: Infinity,
    managedLlmUsdPerMonth: 0
  },
  team: {
    questionsPerMonth: 3_000,
    vectorsMax: 1_000_000,
    uploadsPerMonth: 100,
    projectsMax: 100,
    publicAnswersPerDay: 1_500,
    managedLlmUsdPerMonth: 75
  },
  pro: {
    questionsPerMonth: 500,
    vectorsMax: 150_000,
    uploadsPerMonth: 20,
    projectsMax: 25,
    publicAnswersPerDay: 300,
    managedLlmUsdPerMonth: 13
  },
  starter: {
    questionsPerMonth: 120,
    vectorsMax: 25_000,
    uploadsPerMonth: 10,
    projectsMax: 10,
    publicAnswersPerDay: 100,
    managedLlmUsdPerMonth: 3
  },
  free: {
    questionsPerMonth: 25,
    vectorsMax: 5_000,
    uploadsPerMonth: 3,
    projectsMax: 5,
    publicAnswersPerDay: 50,
    managedLlmUsdPerMonth: 0.5
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
    if (has?.({ plan: 'starter' })) return { slug: 'starter', caps: PLAN_CAPS.starter };
  } catch {
    /* fall through */
  }
  return { slug: 'free', caps: PLAN_CAPS.free };
}
