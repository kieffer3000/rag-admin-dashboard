import { auth } from '@clerk/nextjs/server';
import { createDocExtractJob } from '@/lib/rag/cloudconvert';

// Broker for large-document ingestion. Returns a CloudConvert jobId + a presigned
// upload form; the client POSTs the RAW file straight to CloudConvert (bypassing
// Vercel's ~4.5MB body cap), then calls /api/index-doc with { cc_job_id } to
// finish (poll → extract text → chunk → embed → Pinecone). Mirrors /api/audio-job.

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const ext = typeof body.ext === 'string' ? body.ext : '';
  const ocr = body.ocr === true;

  // SIZE GATE: the presign hop bypasses the platform body cap, so this broker
  // is where the line is drawn — refuse jobs declared over 100MB (conversion
  // minutes cost money; nobody indexes a 100GB "PDF"). The declared size is
  // client-honest only, so /api/index-doc also caps the EXTRACTED text.
  const MAX_DECLARED = 100 * 1024 * 1024;
  const sizeBytes = Number(body.sizeBytes ?? 0);
  if (Number.isFinite(sizeBytes) && sizeBytes > MAX_DECLARED) {
    return Response.json(
      {
        error: `File is ${(sizeBytes / 1048576).toFixed(0)} MB — the maximum for a document is ${MAX_DECLARED / 1048576} MB. Split it and upload the parts.`
      },
      { status: 413 }
    );
  }

  const job = await createDocExtractJob(ext, { ocr, sizeBytes });
  if (!job) {
    return Response.json(
      { error: 'Large-document upload is unavailable (CloudConvert not configured).' },
      { status: 503 }
    );
  }
  return Response.json({ jobId: job.jobId, upload: job.form });
}
