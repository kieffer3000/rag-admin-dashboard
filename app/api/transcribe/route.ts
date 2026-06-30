import { auth } from '@clerk/nextjs/server';
import { pollAudioOutputUrls, AUDIO_CHUNK_SEC } from '@/lib/rag/cloudconvert';

// Speech-to-text → OpenAI Whisper (whisper-1). MULTILINGUAL: auto-detects ~99
// languages (no locale config), returns text + per-segment timestamps + the
// detected language (response_format: verbose_json). One transcriber for the
// whole app — file uploads (RAG/artifact) and the mic voice-notes.
//
// Two input modes:
//  - inline `audio` File — short clips, under Vercel's ~4.5 MB body cap (the mic
//    button is hard-capped at 2 min, so it always fits here).
//  - `ccJobId` — a CloudConvert audio job the client uploaded to directly (long
//    audio). For short audio it's ONE compressed file; for LONG audio (>25 min)
//    it's N 15-min segments (server-side chunking) which we transcribe and
//    stitch back together with per-segment timestamp offsets. Chunking keeps each
//    Whisper call small + reliable — a 2h+ file in one shot 500s / hits the 25MB
//    cap / outruns the fetch timeout.

export const runtime = 'nodejs';
// Long audio (CloudConvert compress + N Whisper calls for a 2–3h file) can exceed
// 300s. 800 is the max with Fluid Compute (clamps to the plan limit otherwise).
export const maxDuration = 800;

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MODEL = process.env.WHISPER_MODEL ?? 'whisper-1';
const WHISPER_MAX = 26214400; // 25 MiB — OpenAI's hard upload cap
const CHUNK_CONCURRENCY = 5; // Whisper calls in flight at once for a chunked job

interface Seg {
  offsetMs: number;
  text: string;
}
interface WhisperResult {
  text: string;
  segments: Seg[];
  language?: string;
}

// undici pieces, resolved once per request (its own fetch + Agent + FormData must
// be a MATCHED set — a standalone-undici Agent on Node's GLOBAL fetch throws
// UND_ERR_INVALID_ARG, and a GLOBAL FormData through undici's fetch drops its
// string fields → OpenAI 400 "missing model"). Mirrors app/api/index-youtube.
interface Undici {
  fetch: (url: string, init: unknown) => Promise<{
    ok: boolean;
    status: number;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
  }>;
  FormData: new () => { append: (name: string, value: unknown, filename?: string) => void };
  dispatcher: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Transcribe ONE audio blob via Whisper. Retries transient OpenAI 5xx + network
 *  failures (up to 3 attempts); throws a typed Error on a hard failure. */
async function callWhisper(
  blob: Blob,
  name: string,
  apiKey: string,
  prompt: string,
  u: Undici
): Promise<WhisperResult> {
  if (blob.size > WHISPER_MAX) {
    const mb = (blob.size / 1048576).toFixed(1);
    const e = new Error(
      `A segment is ${mb}MB after compression (over OpenAI's 25MB limit). Lower AUDIO_COMPRESS_BITRATE or split the file.`
    ) as Error & { status?: number };
    e.status = 413;
    throw e;
  }

  let lastDetail = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    // Rebuild the form each attempt — the body stream is consumed on send.
    const form = new u.FormData();
    form.append('file', blob, name);
    form.append('model', MODEL);
    // verbose_json → text + segment timestamps + the auto-detected language.
    form.append('response_format', 'verbose_json');
    if (prompt) form.append('prompt', prompt);
    // NO `language` field → Whisper auto-detects, so it works in any language.

    let res: Awaited<ReturnType<Undici['fetch']>>;
    try {
      res = await u.fetch(WHISPER_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` }, // undici sets the multipart boundary
        body: form,
        dispatcher: u.dispatcher
      });
    } catch (err) {
      console.error(`[transcribe] whisper fetch threw (attempt ${attempt + 1}):`, err);
      if (attempt < 2) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw new Error('Could not reach transcription service');
    }

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        segments?: Array<{ start?: number; text?: string }>;
        language?: string;
      };
      const text = (data.text ?? '').trim();
      const segments: Seg[] = Array.isArray(data.segments)
        ? data.segments
            .map((s) => ({
              offsetMs: Math.round((typeof s.start === 'number' ? s.start : 0) * 1000),
              text: (s.text ?? '').trim()
            }))
            .filter((s) => s.text)
        : [];
      return { text, segments, language: data.language };
    }

    lastDetail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 240);
    // 5xx = transient OpenAI error ("you can retry") → back off + retry.
    // 4xx = caller error (bad key/format) → fail immediately, no point retrying.
    if (res.status >= 500 && attempt < 2) {
      console.error(`[transcribe] whisper ${res.status} (retry ${attempt + 1}): ${lastDetail}`);
      await sleep(1500 * (attempt + 1));
      continue;
    }
    console.error(`[transcribe] whisper ${res.status}: ${lastDetail}`);
    const e = new Error(
      lastDetail
        ? `Transcription returned ${res.status}: ${lastDetail}`
        : `Transcription returned ${res.status}`
    ) as Error & { status?: number };
    e.status = 502;
    throw e;
  }
  // Exhausted retries on 5xx.
  const e = new Error(
    lastDetail ? `Transcription failed after retries: ${lastDetail}` : 'Transcription failed after retries'
  ) as Error & { status?: number };
  e.status = 502;
  throw e;
}

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

  // Whisper can take well over undici's DEFAULT 300s headers/body timeout for a
  // long segment — raise it to just under maxDuration. Matched undici set.
  const { Agent, fetch: undiciFetch, FormData: UndiciFormData } = await import('undici');
  const u: Undici = {
    fetch: undiciFetch as unknown as Undici['fetch'],
    FormData: UndiciFormData as unknown as Undici['FormData'],
    dispatcher: new Agent({ headersTimeout: 780_000, bodyTimeout: 780_000 })
  };

  try {
    // ---- Long-audio path: 1..N CloudConvert segments → transcribe + stitch ----
    if (ccJobId) {
      const urls = await pollAudioOutputUrls(ccJobId);
      if (urls.length === 0) {
        return Response.json(
          { error: 'Audio compression failed or timed out.' },
          { status: 502 }
        );
      }

      // Transcribe segments with bounded concurrency (in order, by index).
      const results: WhisperResult[] = new Array(urls.length);
      for (let i = 0; i < urls.length; i += CHUNK_CONCURRENCY) {
        const batch = urls.slice(i, i + CHUNK_CONCURRENCY);
        const done = await Promise.all(
          batch.map(async (url, j) => {
            const idx = i + j;
            const got = await fetch(url).catch(() => null);
            if (!got || !got.ok) {
              throw new Error(`Could not fetch audio segment ${idx + 1} of ${urls.length}.`);
            }
            const blob = await got.blob();
            return callWhisper(blob, `audio-${idx + 1}.m4a`, apiKey, prompt, u);
          })
        );
        done.forEach((r, j) => {
          results[i + j] = r;
        });
      }

      // Stitch: concat text; offset each segment's timestamp by its chunk start.
      const textParts: string[] = [];
      const segments: Seg[] = [];
      let language: string | undefined;
      results.forEach((r, idx) => {
        if (r.text) textParts.push(r.text);
        const base = idx * AUDIO_CHUNK_SEC * 1000;
        for (const s of r.segments) segments.push({ offsetMs: base + s.offsetMs, text: s.text });
        if (!language && r.language) language = r.language;
      });

      return Response.json({ text: textParts.join('\n').trim(), segments, language });
    }

    // ---- Inline path: a short clip POSTed directly (under the body cap) ----
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

    const r = await callWhisper(audio, audio.name || 'audio.wav', apiKey, prompt, u);
    return Response.json({ text: r.text, segments: r.segments, language: r.language });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 502;
    const message = (err as Error).message || 'Transcription failed.';
    return Response.json({ error: message }, { status });
  }
}
