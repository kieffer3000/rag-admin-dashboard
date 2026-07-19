// PROGRESSIVE VOICEOVER — audio starts within a couple seconds instead of after
// the whole answer renders.
//
// The engine (Gemini native TTS, reached via the Make webhook) returns a WHOLE
// clip per call AND can only handle ONE call at a time — the old route always
// synthesized sequentially, so it never bursted it. So we do the same here:
// split the text into a SHORT first chunk (fast first audio) + larger chunks,
// synthesize them ONE AT A TIME in order (a bursted prefetch overloaded the
// webhook → 502s → silence), and play each as it lands. Because a chunk's audio
// is far longer than its synth time, the next chunk is always ready before the
// current one ends — gapless without concurrency.
//
// Cost is UNCHANGED (same characters) and often cheaper: stop() aborts the
// in-flight + remaining synths, so a voiceover you cut off never pays for the
// part you didn't hear. Accuracy is identical: same engine, same voice.

export interface VoiceoverController {
  /** Stop playback, abort the in-flight + remaining chunk synths (stops spend). */
  stop: () => void;
}

interface Opts {
  voice?: string;
  /** Fired when the FIRST chunk actually begins playing. */
  onStart?: () => void;
  /** Fired when the last chunk finishes (natural end) or nothing could play. */
  onEnd?: () => void;
  /** Fired if the FIRST chunk never plays (synth/network/autoplay). Later-chunk
   *  failures are skipped silently so one bad chunk can't kill the rest. */
  onError?: (e: unknown) => void;
}

const FIRST_MAX = 220; // ~one/two sentences → fast first audio
const REST_MAX = 1200; // bigger = fewer round-trips; still well under engine limits

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

/** Synthesize ONE chunk → object URL. One retry for a transient webhook 502. */
async function synthChunk(
  text: string,
  voice: string | undefined,
  signal: AbortSignal
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('/api/voiceover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // chunk:true → inline data URL, no Blob litter; we sized the text here.
        body: JSON.stringify({ text, voice, chunk: true }),
        signal
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? `voiceover ${res.status}`);
      const url = j?.dataUrl ?? j?.url;
      if (!url) throw new Error('no audio returned');
      return url as string;
    } catch (e) {
      if (signal.aborted) throw e;
      lastErr = e;
      // brief backoff before the single retry (webhook was momentarily busy)
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw lastErr;
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

  // Producer: synthesize chunks strictly ONE AT A TIME, in order (never burst
  // the webhook). Results land in `ready` by index; '' marks a failed chunk.
  const ready: Array<string | null> = new Array(chunks.length).fill(null);
  let wake: (() => void) | null = null;
  const bump = () => {
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  };

  (async () => {
    for (let i = 0; i < chunks.length; i++) {
      if (stopped) return;
      try {
        ready[i] = await synthChunk(chunks[i], opts.voice, ac.signal);
      } catch {
        ready[i] = ''; // failed → consumer skips it
      }
      bump();
    }
  })();

  // Consumer: play chunks in order, waiting when the next isn't ready yet.
  (async () => {
    let started = false;
    for (let i = 0; i < chunks.length; i++) {
      while (!stopped && ready[i] === null)
        await new Promise<void>((res) => {
          wake = res;
        });
      if (stopped) return;
      const url = ready[i];
      if (!url) continue; // this chunk failed to synth → skip
      audio.src = url;
      try {
        await audio.play();
      } catch (e) {
        // Autoplay blocked / interrupted. If we've never made a sound, report.
        if (!stopped && !started) {
          opts.onError?.(e);
          return;
        }
        continue;
      }
      if (!started) {
        started = true;
        opts.onStart?.();
      }
      // Wait for this clip to finish (or error) before the next.
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
      if (stopped) return;
    }
    if (!stopped) opts.onEnd?.();
  })();

  return {
    stop: () => {
      stopped = true;
      ac.abort();
      bump();
      try {
        audio.pause();
        audio.src = '';
      } catch {
        /* already torn down */
      }
    }
  };
}
