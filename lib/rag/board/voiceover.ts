// PROGRESSIVE VOICEOVER — audio starts within a couple seconds instead of after
// the whole answer renders.
//
// The engine (Gemini native TTS, reached via the Make webhook) returns a WHOLE
// clip per call — it can't stream partial audio. So we stream at the CHUNK
// level: split the text into a SHORT first chunk (one/two sentences → fast first
// audio) followed by larger chunks, fetch them a couple ahead, and play them in
// order through one <audio> element. Time-to-first-audio drops from "synthesize
// everything" (minutes on a long answer) to "synthesize one sentence" (seconds).
//
// Cost is UNCHANGED — the same characters are synthesized — and it's often
// cheaper: stop() aborts in-flight + pending chunks, so a voiceover you cut off
// never pays to synthesize the part you didn't hear. Accuracy is identical: same
// engine, same voice.

export interface VoiceoverController {
  /** Stop playback, abort in-flight + pending chunk synths (stops the spend). */
  stop: () => void;
}

interface Opts {
  voice?: string;
  /** Fired when the FIRST chunk actually begins playing. */
  onStart?: () => void;
  /** Fired when the last chunk finishes (natural end). */
  onEnd?: () => void;
  /** Fired if the first chunk never plays (synth/network error). Later-chunk
   *  failures are skipped silently so one bad chunk can't kill the rest. */
  onError?: (e: unknown) => void;
}

// First chunk stays tiny so it returns fast; the rest are larger to keep the
// round-trip count (and any per-call Make overhead) low without starving
// playback — we prefetch ahead so the bigger chunks are ready in time.
const FIRST_MAX = 220;
const REST_MAX = 1200;
const PREFETCH_AHEAD = 2;

/** Sentence-aware plan with a short first chunk. */
function planChunks(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  const limit = () => (chunks.length === 0 ? FIRST_MAX : REST_MAX);
  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  for (const s of sentences) {
    if (s.length > limit()) {
      flush();
      for (let i = 0; i < s.length; i += REST_MAX) chunks.push(s.slice(i, i + REST_MAX));
      continue;
    }
    if ((cur + s).length > limit() && cur) flush();
    cur += s;
  }
  flush();
  return chunks;
}

/**
 * Start speaking `text`. Returns a controller whose stop() halts playback and
 * cancels outstanding synths. Call it from a click handler (the <audio> element
 * is created synchronously, in the user gesture).
 */
export function playVoiceover(text: string, opts: Opts = {}): VoiceoverController {
  const chunks = planChunks(text);
  const audio = new Audio(); // created in-gesture
  audio.preload = 'auto';
  const ac = new AbortController();
  let stopped = false;

  if (!chunks.length) {
    queueMicrotask(() => opts.onEnd?.());
    return { stop: () => {} };
  }

  const fetches: Array<Promise<string> | null> = new Array(chunks.length).fill(null);

  function fetchChunk(i: number): Promise<string> {
    if (fetches[i]) return fetches[i]!;
    const p = (async () => {
      const res = await fetch('/api/voiceover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // chunk:true → the route returns an inline data URL (no Blob litter) and
        // skips its own multi-chunk loop; we already sized the text here.
        body: JSON.stringify({ text: chunks[i], voice: opts.voice, chunk: true }),
        signal: ac.signal
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? 'voiceover failed');
      const url = j.dataUrl ?? j.url;
      if (!url) throw new Error('no audio returned');
      return url as string;
    })();
    fetches[i] = p;
    return p;
  }

  function prefetch(from: number) {
    for (let i = from; i < Math.min(chunks.length, from + 1 + PREFETCH_AHEAD); i++)
      fetchChunk(i).catch(() => {}); // errors surface at play time
  }

  async function playFrom(i: number) {
    if (stopped) return;
    if (i >= chunks.length) {
      opts.onEnd?.();
      return;
    }
    prefetch(i);
    let url: string;
    try {
      url = await fetchChunk(i);
    } catch (e) {
      // First chunk failing = nothing to hear → report. A later chunk failing →
      // skip it and keep going so one hiccup can't end the whole read.
      if (stopped) return;
      if (i === 0) opts.onError?.(e);
      else playFrom(i + 1);
      return;
    }
    if (stopped) return;
    audio.src = url;
    audio.onended = () => playFrom(i + 1);
    audio.onerror = () => {
      if (!stopped) playFrom(i + 1);
    };
    try {
      await audio.play();
      if (i === 0) opts.onStart?.();
    } catch (e) {
      // Autoplay blocked or interrupted.
      if (!stopped && i === 0) opts.onError?.(e);
    }
  }

  playFrom(0);

  return {
    stop: () => {
      stopped = true;
      ac.abort();
      try {
        audio.pause();
        audio.src = '';
      } catch {
        /* already torn down */
      }
    }
  };
}
