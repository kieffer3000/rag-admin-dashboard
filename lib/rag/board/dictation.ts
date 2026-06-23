// Browser mic → 16 kHz mono MP3 (WAV fallback). MAI-Transcribe accepts
// WAV/MP3/FLAC only; MediaRecorder emits WebM/Opus, so we capture raw PCM via
// AudioContext and encode it ourselves. We ship MP3 (~48 kbps mono ≈ 0.36 MB/min)
// rather than WAV (~1.9 MB/min) so a recording stays well under Vercel's ~4.5 MB
// request-body cap — lifting the practical limit from ~2.3 min to ~12 min.
// Used for high-accuracy question dictation and voice-memos-as-sources.

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

/** POST a WAV blob to our transcribe proxy. `phrases` biases recognition
 *  toward known entities (the brain's wired source names). */
export async function transcribeAudio(
  blob: Blob,
  phrases: string[] = []
): Promise<string> {
  const fd = new FormData();
  // name by actual container so Azure/our route detect the format correctly
  const ext = blob.type.includes('mpeg') || blob.type.includes('mp3') ? 'mp3' : 'wav';
  fd.append('audio', blob, `dictation.${ext}`);
  if (phrases.length) fd.append('phrases', JSON.stringify(phrases.slice(0, 50)));
  const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    const err = new Error(e.error ?? `Transcription failed (${res.status})`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  const d = await res.json();
  return (d.text as string) ?? '';
}
