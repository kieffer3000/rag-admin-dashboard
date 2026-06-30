import { auth } from '@clerk/nextjs/server';
import { createAudioTranscodeJob, bitrateForDuration } from '@/lib/rag/cloudconvert';

// Brokers a CloudConvert audio-compression job for long-audio transcription.
// Returns the jobId + a presigned upload form; the client PUTs the raw audio
// straight to CloudConvert (bypassing Vercel's ~4.5 MB request-body cap), then
// calls /api/transcribe with the jobId. The CloudConvert API key never leaves
// the server.

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // The client reports the audio duration so we pick the highest-quality bitrate
  // that still fits Whisper's 25MB cap (short clips → crisp; long → compressed).
  let durationSec = 0;
  try {
    const body = (await req.json()) as { durationSec?: number };
    durationSec = Number(body?.durationSec) || 0;
  } catch {
    /* no body → safe default bitrate */
  }

  // Long audio (>25 min) is split into N 15-min segments server-side so each
  // Whisper call is small + reliable; short audio stays a single file. Chunking
  // is invisible to the client — it still uploads once + calls /api/transcribe.
  const job = await createAudioTranscodeJob(durationSec, bitrateForDuration(durationSec));
  if (!job) {
    return Response.json(
      { error: 'Audio compression not configured — set CLOUDCONVERT_API_KEY.' },
      { status: 503 }
    );
  }
  return Response.json({ jobId: job.jobId, upload: job.form, chunks: job.chunks });
}
