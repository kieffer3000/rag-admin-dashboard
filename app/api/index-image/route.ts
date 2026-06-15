import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { deleteSourceVectors } from '@/lib/rag/pinecone-delete';

// Image ingestion → Vercel Blob (durable, displayable URL) + Make.com Image
// scenario (Gemini 2.5 Pro caption + Gemini Embedding 2 on the PIXELS + Pinecone
// upsert). The two model calls live in Make so the operator swaps model IDs in
// the UI when Google bumps them — no redeploy (the whole reason we route the
// LLM/embedding work through Make).
//
// Why Blob here (not Make): hosting the bytes is storage, not a model call —
// the Next.js side already holds BLOB_READ_WRITE_TOKEN (mirrors /api/voiceover).
// The public Blob URL becomes metadata.image_url so the image can be SHOWN back
// in visual search, and Make can also fetch it if it prefers the URL to base64.
//
// Make Image scenario contract (single vector per image):
//   IN  { source_id, chunk_id, name, type:'image', namespace,
//         image_url, mime_type, image_b64 }
//   →   caption = Gemini 2.5 Pro(generateContent, image)        [metadata.text]
//   →   values  = Gemini Embedding 2(embedContent, image, 768d) [the vector]
//   →   Pinecone upsert: id=chunk_id, values, namespace, metadata
//         { source_id, type:'image', image_url, text:caption, name }
//   OUT { ok:true, caption }

export const runtime = 'nodejs';
export const maxDuration = 60;

// Gemini inline image cap is generous (~20MB/request); we keep uploads well
// under that and reject oversize so the base64 payload to Make stays sane.
const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  const name = String(form.get('name') ?? '').trim() || 'Image';
  const sourceId = String(form.get('source_id') ?? '').trim();
  if (!(file instanceof Blob) || !sourceId) {
    return Response.json({ error: 'file and source_id are required' }, { status: 400 });
  }
  const mime = file.type || 'image/png';
  if (!ALLOWED.has(mime)) {
    return Response.json(
      { error: `Unsupported image type ${mime}. Use PNG, JPEG, or WebP.` },
      { status: 415 }
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `Image is ${(file.size / 1048576).toFixed(1)} MB; max is 12 MB.` },
      { status: 413 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // 1) Host the pixels so they can be displayed (and re-fetched) later.
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json(
      { error: 'BLOB_READ_WRITE_TOKEN is not configured' },
      { status: 500 }
    );
  }
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  const blob = await put(`images/${userId}/${sourceId}.${ext}`, bytes, {
    access: 'public',
    contentType: mime,
    addRandomSuffix: true
  });

  const namespace = process.env.PINECONE_NAMESPACE ?? 'user_kieffer';

  // 2) Hand the model work to Make. If the Image webhook isn't wired yet, we
  //    still return the hosted URL so the chip shows the picture — it just
  //    isn't searchable until the scenario exists.
  const webhook = process.env.MAKE_IMAGE_WEBHOOK_URL;
  if (!webhook) {
    return Response.json({
      ok: true,
      indexed: false,
      image_url: blob.url,
      note: 'MAKE_IMAGE_WEBHOOK_URL not configured — stored but not indexed.'
    });
  }

  // Re-index idempotency: clear any prior vectors for this source first.
  try {
    await deleteSourceVectors(sourceId, namespace);
  } catch {
    /* best-effort; upsert overwrites the same id anyway */
  }

  let caption: string | undefined;
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_id: sourceId,
        chunk_id: `${sourceId}#0`,
        name,
        type: 'image',
        namespace,
        image_url: blob.url,
        mime_type: mime,
        image_b64: bytes.toString('base64')
      })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `Make returned ${res.status}`);
    // Make returns "Accepted" if the scenario is on a SCHEDULE (not Immediate).
    if (text.trim() === 'Accepted') {
      return Response.json({
        ok: true,
        indexed: false,
        image_url: blob.url,
        note: 'Image scenario is queued — set it to "Immediately as data arrives" + ON.'
      });
    }
    try {
      caption = JSON.parse(text)?.caption;
    } catch {
      /* non-JSON OK */
    }
  } catch (e: any) {
    return Response.json(
      { ok: false, indexed: false, image_url: blob.url, error: e?.message ?? 'index failed' },
      { status: 502 }
    );
  }

  return Response.json({ ok: true, indexed: true, image_url: blob.url, caption });
}
