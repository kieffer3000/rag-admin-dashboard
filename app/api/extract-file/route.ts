import { auth } from '@clerk/nextjs/server';
import { extractDocumentText } from '@/lib/rag/doc-extract';
import { pollDocTextUrl } from '@/lib/rag/cloudconvert';

// Extract-only file reader for the Opine ARTIFACT (right plug). Pulls the text
// from an uploaded PDF/DOCX/EPUB/TXT/MD and returns it — WITHOUT indexing it into
// Pinecone (artifacts are carried whole, never part of the knowledge base).

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // ── JSON job mode ────────────────────────────────────────────────────────
  // Big binaries went browser→CloudConvert (presign via /api/doc-job — no
  // ~4.5MB body cap); we poll the job and return the extracted text WITHOUT
  // indexing. Mirrors /api/index-doc's JSON mode, minus the pipeline.
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null);
    const ccJobId = String(body?.cc_job_id ?? '').trim();
    if (!ccJobId) {
      return Response.json({ ok: false, note: 'cc_job_id is required.' }, { status: 400 });
    }
    const txtUrl = await pollDocTextUrl(ccJobId);
    if (!txtUrl) {
      return Response.json(
        { ok: false, note: 'Text extraction failed or timed out.' },
        { status: 200 }
      );
    }
    try {
      const tr = await fetch(txtUrl);
      if (!tr.ok) throw new Error(`fetch text ${tr.status}`);
      const text = (await tr.text()).trim();
      if (text.length < 20) {
        return Response.json({
          ok: false,
          note: 'No extractable text — possibly a scanned/image PDF. Retry with OCR on.'
        });
      }
      return Response.json({ ok: true, text });
    } catch (e: unknown) {
      return Response.json(
        {
          ok: false,
          note: `Could not read the extracted text: ${e instanceof Error ? e.message : 'error'}`
        },
        { status: 200 }
      );
    }
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  const ocr = ['true', '1', 'on'].includes(String(form.get('ocr') ?? '').toLowerCase());
  if (!(file instanceof Blob)) {
    return Response.json({ ok: false, note: 'A file is required.' }, { status: 200 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { ok: false, note: `File is ${(file.size / 1048576).toFixed(1)} MB; max is 25 MB.` },
      { status: 200 }
    );
  }

  const filename = (file as File).name ?? 'document';
  const result = await extractDocumentText(file, filename, ocr);
  return Response.json(result, { status: 200 });
}
