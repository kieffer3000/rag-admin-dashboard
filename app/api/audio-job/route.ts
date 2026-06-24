import { auth } from '@clerk/nextjs/server';
import { createAudioCompressJob } from '@/lib/rag/cloudconvert';

// Brokers a CloudConvert audio-compression job for long-audio transcription.
// Returns the jobId + a presigned upload form; the client PUTs the raw audio
// straight to CloudConvert (bypassing Vercel's ~4.5 MB request-body cap), then
// calls /api/transcribe with the jobId. The CloudConvert API key never leaves
// the server.

export const runtime = 'nodejs';

export async function POST() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const job = await createAudioCompressJob();
  if (!job) {
    return Response.json(
      { error: 'Audio compression not configured — set CLOUDCONVERT_API_KEY.' },
      { status: 503 }
    );
  }
  return Response.json({ jobId: job.jobId, upload: job.form });
}
