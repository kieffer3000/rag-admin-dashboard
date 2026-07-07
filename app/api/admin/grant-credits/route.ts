import { auth, clerkClient } from '@clerk/nextjs/server';
import { bumpUsage, monthPeriod } from '@/lib/rag/metering';
import { resolvePlan } from '@/lib/rag/plans';

// OVERAGE TOP-UPS (3.27) — owner-only grant route. Selling a credit pack
// today = collect payment however you like (invoice/Stripe link), then grant
// the credits here; the question gates add `topup_questions` to the scope's
// monthly allowance. When Stripe/Clerk add-on checkout lands, its webhook
// calls the same counter. PERMANENT route (unlike the invite temp-routes):
// it is Clerk-gated + owner-checked, and grants only ever ADD allowance.
//
// POST { email: "customer@x.com", credits: 100 }
//   or { scope: "user:user_abc" | "org_abc", credits: 100 }
// → { ok, scope, granted, topupThisMonth }

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId, has } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { slug } = await resolvePlan(userId, has);
  if (slug !== 'owner') {
    return Response.json({ error: 'Owner only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const credits = Number(body.credits);
  if (!Number.isFinite(credits) || credits <= 0 || credits > 100_000) {
    return Response.json(
      { error: 'credits must be a positive number (≤100000)' },
      { status: 400 }
    );
  }

  let scope = typeof body.scope === 'string' ? body.scope.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!scope && email) {
    try {
      const client = await clerkClient();
      const list = await client.users.getUserList({ emailAddress: [email] });
      const u = list.data[0];
      if (!u) return Response.json({ error: `No user with email ${email}` }, { status: 404 });
      scope = `user:${u.id}`;
    } catch {
      return Response.json({ error: 'User lookup failed' }, { status: 502 });
    }
  }
  if (!scope) {
    return Response.json({ error: 'Provide email or scope' }, { status: 400 });
  }

  const total = await bumpUsage(scope, 'topup_questions', monthPeriod(), credits);
  if (total === 0) {
    return Response.json({ error: 'Counter store unavailable' }, { status: 503 });
  }
  console.info(`[grant-credits] ${scope} +${credits} → topup ${total} (${monthPeriod()})`);
  return Response.json({
    ok: true,
    scope,
    granted: credits,
    topupThisMonth: total,
    month: monthPeriod()
  });
}
