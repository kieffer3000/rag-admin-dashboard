import { auth } from '@clerk/nextjs/server';
import { createSign } from 'crypto';

// Voiceover → Google Cloud Text-to-Speech DIRECT (texttospeech.googleapis.com),
// WaveNet neural voice. Replaces the old Make→Gemini-native-TTS relay (3.38):
//   - ~15-19× faster synth (MEASURED: 421 chars in 1.1s vs Gemini's ~19s) →
//     sub-second first audio and no possible playback seam.
//   - Cheaper: WaveNet $4/1M chars + a permanent 1M-char/mo free tier (vs
//     Gemini ~$15/1M-equivalent) — and no per-answer Make ops.
// Cloud TTS rejects API keys, so we mint an OAuth token from a service-account
// JSON (GOOGLE_TTS_SA_JSON, base64) using Node's built-in crypto — no new dep.
// LINEAR16 output is already a RIFF/WAVE container, so we return it as-is for a
// single chunk; only multi-chunk (rare) strips+concats PCM and re-wraps.

export const runtime = 'nodejs';

const DEFAULT_VOICE = process.env.GOOGLE_TTS_VOICE ?? 'en-US-Wavenet-F';
const SAMPLE_RATE = 24000;
const MAX_CHARS = 3000; // safely under Cloud TTS's ~5000-byte input limit

type SA = { client_email: string; private_key: string };
function loadSA(): SA {
  const raw = process.env.GOOGLE_TTS_SA_JSON;
  if (!raw) throw new Error('GOOGLE_TTS_SA_JSON not set');
  // Accept base64 (preferred) or raw JSON.
  const json = raw.trim().startsWith('{')
    ? raw
    : Buffer.from(raw, 'base64').toString('utf8');
  const sa = JSON.parse(json);
  if (!sa.client_email || !sa.private_key) throw new Error('bad service account');
  return sa;
}

// OAuth token cached across warm invocations (tokens last ~1h).
let cachedToken: { token: string; expMs: number } | null = null;
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expMs - now > 60_000) return cachedToken.token;
  const sa = loadSA();
  const iat = Math.floor(now / 1000);
  const b64url = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600
  };
  const signingInput = `${b64url(header)}.${b64url(claim)}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(sa.private_key)
    .toString('base64url');
  const assertion = `${signingInput}.${signature}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token)
    throw new Error(`token exchange ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  cachedToken = { token: j.access_token, expMs: now + (j.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

/** One synth → a complete WAV Buffer (LINEAR16 is already RIFF-wrapped). */
async function synth(text: string, voice: string): Promise<Buffer> {
  const token = await getAccessToken();
  const languageCode = voice.split('-').slice(0, 2).join('-'); // en-US-Wavenet-F → en-US
  const r = await fetch(
    'https://texttospeech.googleapis.com/v1/text:synthesize',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: voice },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE }
      })
    }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.audioContent)
    throw new Error(`TTS ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return Buffer.from(j.audioContent, 'base64');
}

/** Strip a WAV's header → raw PCM (find the 'data' chunk; fallback 44 bytes). */
function pcmFromWav(wav: Buffer): Buffer {
  const i = wav.indexOf('data');
  return i >= 0 ? wav.subarray(i + 8) : wav.subarray(44);
}

/** Wrap raw 16-bit mono PCM in a RIFF/WAVE header. */
function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Sentence-aware split so each synth stays under the input-byte limit. */
function chunkText(text: string, max: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return [clean];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (cur.trim()) chunks.push(cur.trim());
      cur = '';
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

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.GOOGLE_TTS_SA_JSON) {
    return Response.json(
      { error: 'Voiceover not configured — set GOOGLE_TTS_SA_JSON.' },
      { status: 503 }
    );
  }

  let body: { text?: string; voice?: string; chunk?: boolean };
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
    const parts = chunkText(text, MAX_CHARS);
    let wav: Buffer;
    if (parts.length === 1) {
      wav = await synth(parts[0], voice); // already a WAV — no re-wrap
    } else {
      const pcms: Buffer[] = [];
      for (const p of parts) pcms.push(pcmFromWav(await synth(p, voice)));
      wav = pcmToWav(Buffer.concat(pcms));
    }
    const seconds = Math.round(pcmFromWav(wav).length / (SAMPLE_RATE * 2));
    // Audio is regenerable → always inline (no Blob litter, no durable store).
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
