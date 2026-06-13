import { auth } from '@clerk/nextjs/server';

// Voiceover proxy → Gemini API native TTS (generativelanguage.googleapis.com).
// Why Gemini TTS and not Cloud Text-to-Speech: texttospeech.googleapis.com
// REJECTS API keys (needs OAuth/service-account — that's why Make uses a Google
// *connection*). Gemini native TTS accepts our existing GEMINI_API_KEY, so no
// new credential is needed. Bills to the operator's Gemini key = the metered
// add-on on our GCP, by design.
//   POST models/{model}:generateContent?key=…
//   body  { contents, generationConfig.responseModalities:['AUDIO'],
//           speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName }
//   out   candidates[0].content.parts[].inlineData.data = base64 RAW PCM
//         (audio/L16;codec=pcm;rate=24000) — NOT a container, so we wrap WAV.
// For "huge answers" we sentence-chunk under the per-call budget and concat the
// PCM (clean for raw PCM; no GCS/long-audio round-trip required).

export const runtime = 'nodejs';

const TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts';
const DEFAULT_VOICE = process.env.GEMINI_TTS_VOICE ?? 'Leda';
const SAMPLE_RATE = 24000; // Gemini TTS PCM output rate
const MAX_CHARS = 4500; // per-call chunk budget (kept well under model limits)

/** Wrap raw 16-bit mono PCM in a minimal RIFF/WAVE header for browser <audio>. */
function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Sentence-aware split so each TTS call stays inside the per-call budget. */
function chunkText(text: string, max: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return [clean];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (cur.trim()) {
        chunks.push(cur.trim());
        cur = '';
      }
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max));
      continue;
    }
    if ((cur + s).length > max && cur) {
      chunks.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

async function synth(text: string, voice: string, key: string): Promise<Buffer> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
        }
      }
    })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`TTS ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  const data = j?.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: { data?: string } }) => p?.inlineData?.data
  )?.inlineData?.data;
  if (!data) throw new Error('TTS returned no audio');
  return Buffer.from(data, 'base64');
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return Response.json(
      { error: 'Voiceover not configured — set GEMINI_API_KEY.' },
      { status: 503 }
    );
  }

  let body: { text?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return Response.json({ error: 'text is required' }, { status: 400 });
  const voice =
    typeof body?.voice === 'string' && body.voice ? body.voice : DEFAULT_VOICE;

  try {
    const chunks = chunkText(text, MAX_CHARS);
    const pcms: Buffer[] = [];
    // sequential keeps utterance order and avoids burst rate-limits
    for (const c of chunks) pcms.push(await synth(c, voice, key));
    const pcm = Buffer.concat(pcms);
    const wav = pcmToWav(pcm);
    const seconds = Math.round(pcm.length / (SAMPLE_RATE * 2));

    // Durable cache when a Blob store is linked; else inline for the session
    // (the artifact's text is re-indexable regardless, so audio is regenerable).
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { put } = await import('@vercel/blob');
        const blob = await put(`voiceover/${userId}/${Date.now()}.wav`, wav, {
          access: 'public',
          contentType: 'audio/wav'
        });
        return Response.json({ url: blob.url, durable: true, seconds, voice });
      } catch {
        /* fall through to inline */
      }
    }
    return Response.json({
      dataUrl: `data:audio/wav;base64,${wav.toString('base64')}`,
      durable: false,
      seconds,
      voice
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'voiceover failed';
    return Response.json({ error: message }, { status: 502 });
  }
}
