// Browser mic → 16 kHz mono 16-bit WAV. MAI-Transcribe accepts WAV/MP3/FLAC
// only; MediaRecorder emits WebM/Opus, so we capture PCM via AudioContext and
// encode the WAV ourselves. Used for high-accuracy question dictation and
// (later) voice-memos-as-sources.

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
    return encodeWav(pcm, this.target);
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
  fd.append('audio', blob, 'dictation.wav');
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
