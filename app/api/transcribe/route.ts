import { auth } from '@clerk/nextjs/server';
import { pollAudioCompressedUrl } from '@/lib/rag/cloudconvert';

// Speech-to-text → OpenAI Whisper (whisper-1). MULTILINGUAL: auto-detects ~99
// languages (no locale config), returns text + per-segment timestamps + the
// detected language (response_format: verbose_json). One transcriber for the
// whole app — file uploads (RAG/artifact) and the mic voice-notes.
//
// Two input modes:
//  - inline `audio` File — short clips, under Vercel's ~4.5 MB body cap (the mic
//    button is hard-capped at 2 min, so it always fits here).
//  - `ccJobId` — a CloudConvert audio-compress job the client uploaded to
//    directly (long audio); we fetch the compressed file server-side (no cap).
//    Compressed @16 kbps so even a 3 h recording stays under Whisper's 25 MB cap.

export const runtime = 'nodejs';
// Long audio (CloudConvert compress + Whisper for a 2–3h file) can exceed 300s.
// 800 is the max with Fluid Compute (clamps to the plan limit otherwise).
export const maxDuration = 800;

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MODEL = process.env.WHISPER_MODEL ?? 'whisper-1';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'Transcription not configured — set OPENAI_API_KEY.' },
      { status: 503 }
    );
  }

  const inForm = await req.formData();

  const ccJobId = String(inForm.get('ccJobId') ?? '').trim();
  let audioBlob: Blob;
  let audioName = 'audio.wav';

  if (ccJobId) {
    const url = await pollAudioCompressedUrl(ccJobId);
    if (!url) {
      return Response.json({ error: 'Audio compression failed or timed out.' }, { status: 502 });
    }
    const got = await fetch(url).catch(() => null);
    if (!got || !got.ok) {
      return Response.json({ error: 'Could not fetch compressed audio.' }, { status: 502 });
    }
    audioBlob = await got.blob();
    audioName = 'audio.mp3';
  } else {
    const audio = inForm.get('audio');
    if (!(audio instanceof File)) {
      return Response.json({ error: 'audio file is required' }, { status: 400 });
    }
    // A bare WAV header is 44 bytes — anything near that captured no audio.
    if (audio.size < 2048) {
      return Response.json(
        {
          error:
            'That recording was empty — no audio was captured. Check the mic is allowed, then hold the recording a moment longer.'
        },
        { status: 400 }
      );
    }
    audioBlob = audio;
    audioName = audio.name || 'audio.wav';
  }

  // Hard guard: OpenAI rejects > 25 MiB. The compressor sizes by duration to stay
  // under this, but a truly enormous recording (~6h+) could still exceed it — give
  // a clear, actionable error instead of OpenAI's raw 413.
  const WHISPER_MAX = 26214400; // 25 MiB
  if (audioBlob.size > WHISPER_MAX) {
    const mb = (audioBlob.size / 1048576).toFixed(1);
    return Response.json(
      {
        error: `This recording is too long to transcribe in one piece (${mb}MB after compression; OpenAI's limit is 25MB, about ~6 hours). Please split it into shorter parts and upload each.`
      },
      { status: 413 }
    );
  }

  // Optional biasing: wired source names nudge recognition of domain terms
  // (Whisper's `prompt` is a soft hint, ≤ ~224 tokens — we cap the text).
  let prompt = '';
  const raw = inForm.get('phrases');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        prompt = parsed
          .filter((p) => typeof p === 'string')
          .slice(0, 50)
          .join(', ')
          .slice(0, 800);
      }
    } catch {
      /* ignore malformed phrase list */
    }
  }

  const outForm = new FormData();
  outForm.append('file', audioBlob, audioName);
  outForm.append('model', MODEL);
  // verbose_json → text + segment timestamps + the auto-detected language.
  outForm.append('response_format', 'verbose_json');
  if (prompt) outForm.append('prompt', prompt);
  // NO `language` field → Whisper auto-detects, so it works in any language.

  let res: Response;
  try {
    res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` }, // fetch sets the multipart boundary
      body: outForm
    });
  } catch {
    return Response.json({ error: 'Could not reach transcription service' }, { status: 502 });
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 240);
    console.error(`[transcribe] whisper ${res.status}: ${detail}`);
    return Response.json(
      {
        error: detail
          ? `Transcription returned ${res.status}: ${detail}`
          : `Transcription returned ${res.status}`,
        detail
      },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  const text = ((data.text as string) ?? '').trim();

  // Whisper verbose_json segments carry start/end in SECONDS → ms for our [M:SS]
  // markers, so audio chunks keep their timecode and citations point to the moment.
  const segments = Array.isArray(data.segments)
    ? (data.segments as Array<{ start?: number; text?: string }>)
        .map((s) => ({
          offsetMs: Math.round((typeof s.start === 'number' ? s.start : 0) * 1000),
          text: (s.text ?? '').trim()
        }))
        .filter((s) => s.text)
    : [];

  return Response.json({ text, segments, language: data.language });
}
