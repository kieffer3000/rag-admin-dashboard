import { clerkMiddleware, createRouteMatcher, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/not-authorized',
  '/api/webhooks(.*)'
]);

// Private app — only these emails may use it (comma-separated override via
// ALLOWED_EMAILS). Clerk's native allowlist needs a paid plan, so we gate in
// code: covers both the dashboard UI and the API routes in one chokepoint.
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? 'tiosquareinc@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  // Signed-in users hitting auth pages go home.
  if (userId && /^\/sign-(in|up)/.test(req.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/', req.url));
  }

  if (!isPublicRoute(req) && !userId) {
    // Manual redirect instead of auth.protect(): protect() serves a 404
    // rewrite to bots/crawlers; this gives EVERY unauthenticated visitor
    // a clean 307 to /sign-in. (Lesson learned on the caracomp app.)
    const signInUrl = new URL('/sign-in', req.url);
    signInUrl.searchParams.set('redirect_url', req.url);
    return NextResponse.redirect(signInUrl, 307);
  }

  // Owner-only lockdown: a signed-in user whose email isn't allowlisted is
  // blocked (APIs get 403 JSON, pages go to /not-authorized). Fail-open only on
  // a transient lookup error so the owner is never locked out by a hiccup.
  if (userId && !isPublicRoute(req)) {
    try {
      const client = await clerkClient();
      const u = await client.users.getUser(userId);
      const email = (
        u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
        u.emailAddresses[0]?.emailAddress ??
        ''
      ).toLowerCase();
      if (email && !ALLOWED_EMAILS.includes(email)) {
        if (req.nextUrl.pathname.startsWith('/api')) {
          return NextResponse.json({ error: 'Access restricted' }, { status: 403 });
        }
        return NextResponse.redirect(new URL('/not-authorized', req.url), 307);
      }
    } catch {
      /* transient Clerk lookup error → don't lock the owner out */
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*'
  ]
};
