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

  const job = await createDocExtractJob(ext, { ocr });
  if (!job) {
    return Response.json(
      { error: 'Large-document upload is unavailable (CloudConvert not configured).' },
      { status: 503 }
    );
  }
  return Response.json({ jobId: job.jobId, upload: job.form });
}
