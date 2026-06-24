import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/api/admin/migrate-scope' // TEMP: secret-gated one-off migration (removed after use)
]);

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
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/:path*'
  ]
};
