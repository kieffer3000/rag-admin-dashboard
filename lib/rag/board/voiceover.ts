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

  // SERIALIZED synth via a promise CHAIN — chunk i's synth starts only after
  // chunk i-1's settles, so the webhook is never called concurrently (a burst
  // is what 502'd in 3.32). Each entry is a plain promise<url|null>. Awaiting a
  // plain promise CANNOT lose a wakeup, unlike the hand-rolled latch this
  // replaces: if the producer signalled in the gap between the consumer's
  // "is it ready?" check and its sleep, that signal was lost and playback
  // stalled after the first clip — the "reads 2 lines then stops" bug.
  const synth: Array<Promise<string | null>> = [];
  let prev: Promise<unknown> = Promise.resolve();
  for (let i = 0; i < chunks.length; i++) {
    const idx = i;
    const mine = prev.then(async () => {
      if (stopped) return null;
      try {
        return await synthChunk(chunks[idx], opts.voice, ac.signal);
      } catch {
        return null; // failed chunk → skipped at play time; chain continues
      }
    });
    synth.push(mine);
    prev = mine.catch(() => null); // keep the chain alive past any one failure
  }

  // Consumer: play chunks strictly in order. synth[i+1] is already running while
  // chunk i plays, so these awaits resolve near-instantly and playback is gapless.
  (async () => {
    let started = false;
    for (let i = 0; i < chunks.length; i++) {
      if (stopped) return;
      const url = await synth[i];
      if (stopped) return;
      if (!url) continue; // this chunk failed to synth → skip, keep going
      audio.src = url;
      try {
        await audio.play();
      } catch (e) {
        // Autoplay blocked / interrupted. If nothing has sounded yet, report.
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
      // Wait for THIS clip to finish before the next. Clear the handlers on
      // settle so a stale event from the previous src can't resolve early.
      await new Promise<void>((resolve) => {
        const done = () => {
          audio.onended = null;
          audio.onerror = null;
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
      });
    }
    if (!stopped) opts.onEnd?.();
  })();

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
