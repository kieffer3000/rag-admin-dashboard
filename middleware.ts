import { clerkMiddleware, createRouteMatcher, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { allowedOriginsForSlug } from '@/lib/rag/embed-origins';
import { allowedOriginsForRoomSlug } from '@/lib/rag/room-origins';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/not-authorized',
  '/api/webhooks(.*)',
  // Server-to-server (Make ingest → Nova captioner). Clerk-exempt; the route
  // enforces its own CAPTION_WEBHOOK_SECRET shared-secret header instead.
  '/api/caption-image',
  // TEMP (delete after use): headless Clerk invitation, guarded by
  // CAPTION_WEBHOOK_SECRET header inside the route.
  '/api/admin/invite-user',
  // Public published-Bank surfaces: the key-authed Q&A API (auth = per-Bank API
  // key, enforced in the route) and the embeddable chat widget that calls it.
  '/api/v1(.*)',
  '/embed(.*)'
]);

// Private app — only these emails may use it (comma-separated override via
// ALLOWED_EMAILS). Clerk's native allowlist needs a paid plan, so we gate in
// code: covers both the dashboard UI and the API routes in one chokepoint.
const ALLOWED_EMAILS = (
  process.env.ALLOWED_EMAILS ?? 'tiosquareinc@gmail.com,nc@tiosquare.com,ni@tiosquare.com'
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// When OFF (default): app is PRIVATE — only ALLOWED_EMAILS get in.
// When ON: app is OPEN to paying customers — allowlisted OR an active
// subscription (individual `pro` or org `team` seat) gets in; everyone else is
// sent to /pricing to subscribe.
const BILLING_OPEN = process.env.BILLING_OPEN === 'on';
const PLAN_SLUGS = ['pro', 'team'];

export default clerkMiddleware(async (auth, req) => {
  const { userId, has } = await auth();

  // Embed widget: frame-LOCK it to the key's allowed domains so a browser
  // refuses to render the widget on any other site (the real "can't use it
  // outside that domain"). Unknown key / DB error → 'none' (fail closed).
  if (req.nextUrl.pathname.startsWith('/embed/')) {
    // Path is either /embed/<connSlug> (single Bank) or /embed/room/<roomSlug>
    // (the Boardroom). Frame-lock to whichever record's allowed origins.
    const parts = req.nextUrl.pathname.split('/'); // ['', 'embed', a, b?]
    const isRoom = parts[2] === 'room';
    const slug = decodeURIComponent((isRoom ? parts[3] : parts[2]) ?? '');
    const origins = isRoom
      ? await allowedOriginsForRoomSlug(slug)
      : await allowedOriginsForSlug(slug);
    const ancestors = origins && origins.length > 0 ? origins.join(' ') : "'none'";
    const res = NextResponse.next();
    res.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);
    res.headers.delete('X-Frame-Options'); // CSP is authoritative; avoid a DENY clash
    return res;
  }

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

  // Access gate. Owners (ALLOWED_EMAILS) are always in. Otherwise: PRIVATE mode
  // blocks everyone else; OPEN mode (BILLING_OPEN) lets active subscribers in and
  // sends the rest to /pricing. Fail-open only on a transient lookup error so the
  // owner is never locked out by a hiccup.
  if (userId && !isPublicRoute(req)) {
    // /pricing must stay reachable for any signed-in user so they can subscribe.
    if (req.nextUrl.pathname === '/pricing') return;

    const isApi = req.nextUrl.pathname.startsWith('/api');
    try {
      const client = await clerkClient();
      const u = await client.users.getUser(userId);
      const email = (
        u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
        u.emailAddresses[0]?.emailAddress ??
        ''
      ).toLowerCase();

      const isOwner = !!email && ALLOWED_EMAILS.includes(email);
      if (isOwner) return; // allowlisted → always allowed, never paywalled

      if (!BILLING_OPEN) {
        // PRIVATE: non-allowlisted users are blocked entirely.
        if (email) {
          return isApi
            ? NextResponse.json({ error: 'Access restricted' }, { status: 403 })
            : NextResponse.redirect(new URL('/not-authorized', req.url), 307);
        }
      } else {
        // OPEN: require an active subscription (individual `pro` or org `team`).
        const subscribed = PLAN_SLUGS.some((slug) => has({ plan: slug }));
        if (!subscribed) {
          return isApi
            ? NextResponse.json({ error: 'Subscription required' }, { status: 402 })
            : NextResponse.redirect(new URL('/pricing', req.url), 307);
        }
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
