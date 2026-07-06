import { clerkClient } from '@clerk/nextjs/server';

// TEMP ROUTE (build-and-delete, same session): create a Clerk invitation
// headlessly using the server's own CLERK_SECRET_KEY (sealed in Vercel —
// unreadable from outside, which is exactly why this runs server-side).
// Clerk-exempt in middleware; guarded by the CAPTION_WEBHOOK_SECRET header.
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = req.headers.get('x-admin-secret') ?? '';
  if (!process.env.CAPTION_WEBHOOK_SECRET || secret !== process.env.CAPTION_WEBHOOK_SECRET)
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  let email = '';
  try {
    email = String((await req.json()).email ?? '');
  } catch {
    /* fall through to the validation below */
  }
  if (!email.includes('@'))
    return Response.json({ error: 'email required' }, { status: 400 });
  try {
    const inv = await (await clerkClient()).invitations.createInvitation({
      emailAddress: email,
      notify: true
    });
    return Response.json({ ok: true, id: inv.id, status: inv.status });
  } catch (e) {
    const err = e as { errors?: { message?: string }[] };
    return Response.json(
      { error: err?.errors?.[0]?.message ?? String(e) },
      { status: 500 }
    );
  }
}
