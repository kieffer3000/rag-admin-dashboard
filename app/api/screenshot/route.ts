import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { captureWebsiteScreenshot } from '@/lib/rag/cloudconvert';

// Pixel-accurate website screenshot for the Opine ARTIFACT preview. Renders via
// CloudConvert (Puppeteer), then PERSISTS the PNG to Vercel Blob so the preview
// survives (CloudConvert export URLs expire). Returns { ok, url }. Slow (~5-20s,
// a render job) so the artifact node calls it in the background after loading.

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url = body?.url;
  if (!url || typeof url !== 'string') {
    return Response.json({ ok: false, note: 'A URL is required.' }, { status: 200 });
  }

  const tempUrl = await captureWebsiteScreenshot(url);
  if (!tempUrl) {
    return Response.json(
      { ok: false, note: 'Could not capture a screenshot of that page.' },
      { status: 200 }
    );
  }

  // Persist the PNG (CloudConvert URLs expire). Fall back to the temp URL if Blob
  // isn't configured — better a 24h preview than none.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ ok: true, url: tempUrl }, { status: 200 });
  }
  try {
    const png = await fetch(tempUrl);
    if (!png.ok) return Response.json({ ok: true, url: tempUrl }, { status: 200 });
    const bytes = Buffer.from(await png.arrayBuffer());
    const blob = await put(`artifact-shots/${userId}/shot.png`, bytes, {
      access: 'public',
      addRandomSuffix: true,
      contentType: 'image/png'
    });
    return Response.json({ ok: true, url: blob.url }, { status: 200 });
  } catch {
    return Response.json({ ok: true, url: tempUrl }, { status: 200 });
  }
}
