// Browser mic → 16 kHz mono MP3 (WAV fallback). MediaRecorder emits WebM/Opus,
// so we capture raw PCM via AudioContext and encode it ourselves. We ship MP3
// (~48 kbps mono ≈ 0.36 MB/min) rather than WAV (~1.9 MB/min) so a recording
// stays well under Vercel's ~4.5 MB request-body cap.
// ALL transcription (mic notes + uploaded audio files, board + Library/Pinecone)
// funnels through ONE hardened path: transcribeAudioDetailed → /api/transcribe
// (OpenAI Whisper). Large/long audio routes via /api/audio-job → CloudConvert,
// which compresses to AAC and SPLITS long files into 15-min segments the
// transcribe route stitches back — so no caller hits the 25MB cap / 500 / timeout.

export class WavRecorder {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: ScriptProcessorNode;
  private chunks: Float32Array[] = [];
  private inputRate = 48000;
  private readonly target = 16000;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    this.inputRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = (e) => {
      // Copy — the underlying buffer is reused across callbacks.
      this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.node);
    // ScriptProcessor must be in the graph to fire; it writes no output, so
    // connecting to destination is silent (no mic-to-speaker feedback).
    this.node.connect(this.ctx.destination);
  }

  async stop(): Promise<Blob> {
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    const pcm = downsample(merge(this.chunks), this.inputRate, this.target);
    await this.ctx?.close();
    // Prefer MP3 (small); fall back to WAV if the encoder can't load.
    try {
      return await encodeMp3(pcm, this.target);
    } catch {
      return encodeWav(pcm, this.target);
    }
  }
}

function merge(chunks: Float32Array[]): Float32Array {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function downsample(buf: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return buf;
  const ratio = from / to;
  const out = new Float32Array(Math.round(buf.length / ratio));
  let oi = 0;
  let i = 0;
  while (oi < out.length) {
    const next = Math.round((oi + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = i; j < next && j < buf.length; j++) {
      sum += buf[j];
      count++;
    }
    out[oi++] = count ? sum / count : 0;
    i = next;
  }
  return out;
}

/** Encode mono PCM → MP3 (MPEG-2 at 16 kHz) via lamejs, loaded lazily so it
 *  never lands in the SSR/main bundle. ~48 kbps mono is ample for speech STT. */
async function encodeMp3(
  samples: Float32Array,
  rate: number,
  kbps = 48
): Promise<Blob> {
  const lame: any = await import('@breezystack/lamejs');
  const Mp3Encoder = lame.Mp3Encoder ?? lame.default?.Mp3Encoder;
  const enc = new Mp3Encoder(1, rate, kbps);

  // Float32 [-1,1] → Int16 PCM.
  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const blockSize = 1152; // one MP3 frame's worth of samples
  const parts: Uint8Array[] = [];
  for (let i = 0; i < pcm16.length; i += blockSize) {
    const buf = enc.encodeBuffer(pcm16.subarray(i, i + blockSize));
    if (buf.length) parts.push(new Uint8Array(buf));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));

  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}

function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  w(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

export interface TranscriptSegment {
  offsetMs: number;
  text: string;
}
export interface DetailedTranscript {
  text: string;
  segments: TranscriptSegment[];
}

// Vercel function bodies cap at ~4.5 MB — above this we route the audio through
// CloudConvert (direct upload) instead of POSTing it inline.
const COMPRESS_OVER_BYTES = 4 * 1024 * 1024;

/** The TRUE file extension, so CloudConvert detects the format correctly. The
 *  old code named everything .wav/.mp3, so an m4a/aac/ogg upload was mislabeled
 *  and the convert job failed ("Something went wrong"). Prefer the real filename,
 *  fall back to the MIME type. */
function audioExt(blob: Blob): string {
  const name =
    typeof (blob as { name?: unknown }).name === 'string' ? (blob as File).name : '';
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  if (m) return m[1].toLowerCase();
  const t = (blob.type || '').toLowerCase();
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'm4a';
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
  if (t.includes('ogg')) return 'ogg';
  if (t.includes('flac')) return 'flac';
  if (t.includes('webm')) return 'webm';
  if (t.includes('wav')) return 'wav';
  return 'mp3';
}

async function parseTranscribeResponse(res: Response): Promise<DetailedTranscript> {
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error(e.error ?? `Transcription failed (${res.status})`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  const d = await res.json();
  return {
    text: (d.text as string) ?? '',
    segments: Array.isArray(d.segments) ? (d.segments as TranscriptSegment[]) : []
  };
}

/** Long audio: upload the raw file STRAIGHT to CloudConvert (presigned form, no
 *  Vercel cap), compress to MP3, then transcribe the result by jobId (the route
 *  fetches the small compressed file server-side). Returns null if compression
 *  is unavailable so the caller can fall back. */
/** Read an audio file's duration (seconds) in the browser — lets the server pick
 *  the best bitrate that still fits Whisper's 25MB cap. 0 if it can't be read. */
function audioDurationSec(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    try {
      const el = document.createElement('audio');
      el.preload = 'metadata';
      const url = URL.createObjectURL(blob);
      let settled = false;
      const done = (v: number) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(v) && v > 0 ? v : 0);
      };
      el.onloadedmetadata = () => done(el.duration);
      el.onerror = () => done(0);
      el.src = url;
      setTimeout(() => done(el.duration), 8000); // safety net
    } catch {
      resolve(0);
    }
  });
}

async function transcribeViaCompression(
  blob: Blob,
  phrases: string[],
  knownDurationSec?: number
): Promise<DetailedTranscript | null> {
  // Reuse the duration if the caller already measured it (avoids a 2nd decode).
  const durationSec = knownDurationSec ?? (await audioDurationSec(blob));
  const jobRes = await fetch('/api/audio-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ durationSec })
  });
  if (!jobRes.ok) return null;
  const { jobId, upload } = await jobRes.json();
  if (!jobId || !upload?.url) return null;
  const up = new FormData();
  for (const [k, v] of Object.entries(upload.parameters ?? {})) up.append(k, v as string);
  up.append('file', blob, `audio.${audioExt(blob)}`);
  const ur = await fetch(upload.url, { method: 'POST', body: up });
  if (!ur.ok && ur.status !== 201) return null;
  const tfd = new FormData();
  tfd.append('ccJobId', jobId);
  if (phrases.length) tfd.append('phrases', JSON.stringify(phrases.slice(0, 50)));
  return parseTranscribeResponse(await fetch('/api/transcribe', { method: 'POST', body: tfd }));
}

/** POST an audio blob to our transcribe route (OpenAI Whisper) → text + per-
 *  segment timestamps. `phrases` biases recognition toward known entities (wired
 *  source names).
 *
 *  Route through CloudConvert (compress + SERVER-SIDE chunking past ~25min) when
 *  the audio is LARGE *or* LONG — not size alone. A long-but-small file (heavily
 *  pre-compressed) would otherwise go inline as a single Whisper call and risk
 *  the single-shot failures we hardened against (25MB cap / OpenAI 500 / timeout).
 *  Short clips (mic notes ≤2min) stay inline — no CloudConvert round-trip. */
const LONG_AUDIO_SEC = 20 * 60; // ≥20 min → always use the compress+chunk path
export async function transcribeAudioDetailed(
  blob: Blob,
  phrases: string[] = []
): Promise<DetailedTranscript> {
  const durationSec = await audioDurationSec(blob);
  if (blob.size > COMPRESS_OVER_BYTES || durationSec > LONG_AUDIO_SEC) {
    const viaCompress = await transcribeViaCompression(blob, phrases, durationSec);
    if (viaCompress) return viaCompress;
    // compression unavailable → fall through (works for borderline sizes)
  }
  const fd = new FormData();
  // name by actual container so the route detects the format correctly
  fd.append('audio', blob, `dictation.${audioExt(blob)}`);
  if (phrases.length) fd.append('phrases', JSON.stringify(phrases.slice(0, 50)));
  return parseTranscribeResponse(await fetch('/api/transcribe', { method: 'POST', body: fd }));
}

/** Plain-text transcript (dictation → composer). */
export async function transcribeAudio(
  blob: Blob,
  phrases: string[] = []
): Promise<string> {
  return (await transcribeAudioDetailed(blob, phrases)).text;
}

/** ms → [M:SS] (or H:MM:SS for long audio). */
function fmtTs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Transcript with [M:SS] markers per segment — indexed so audio chunks carry
 *  their timecode and citations can point to the moment. Falls back to plain
 *  text when the backend returned no segment timings. */
export function timestampedTranscript(d: DetailedTranscript): string {
  if (!d.segments.length) return d.text;
  return d.segments.map((s) => `[${fmtTs(s.offsetMs)}] ${s.text.trim()}`).join('\n');
}
