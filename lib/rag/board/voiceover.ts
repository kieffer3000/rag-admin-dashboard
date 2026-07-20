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

// ONE shared <audio> element for the whole app (module singleton):
//  - unlockAudio() plays silence through it INSIDE the Audio-Mode toggle click,
//    which grants it the right to play() later WITHOUT a gesture (autoplay
//    policy is per-element on iOS; prior playback satisfies Chrome too).
//  - It also enforces one-voice-at-a-time: starting any voiceover stops the
//    previous one, wherever it was started (bank card or research overlay).
let sharedEl: HTMLAudioElement | null = null;
let activeCtl: VoiceoverController | null = null;
function getSharedEl(): HTMLAudioElement {
  if (!sharedEl) {
    sharedEl = new Audio();
    sharedEl.preload = 'auto';
  }
  return sharedEl;
}

/** Answers are HTML (footnote sups, [n] markers, tags) — speak the PROSE only. */
function speakableText(html: string): string {
  return html
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/\[\d+\](?:\s*\[\d+\])*/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * UNLOCK the shared audio element for later gesture-free playback.
 * MUST be called inside a user gesture (the Audio-Mode toggle click): it plays
 * ~0.1s of silence, which grants the element the right to play() again later
 * without a gesture. Call once; the grant lasts for the page's lifetime.
 */
export function unlockAudio(): void {
  const el = getSharedEl();
  // 0.1s of 24kHz 16-bit mono silence, WAV-wrapped, built inline (no asset).
  const rate = 24000;
  const samples = Math.floor(rate * 0.1);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, samples * 2, true);
  el.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  void el.play().catch(() => {
    /* even a blocked attempt is harmless; the toggle click usually grants it */
  });
}

// RAMPED chunk sizes (3.35). The pipeline only stays gapless if each clip's
// PLAYBACK time covers the NEXT chunk's SYNTH time. Speech ≈ 13 chars/sec but
// synth on this webhook ≈ overhead + ~25ms/char — so a tiny 220-char opener
// (~17s of audio) could never cover a 1200-char follow-up (~35s synth): the
// user heard "two lines… long gap… the rest". Growing sizes gradually keeps
// every clip long enough to hide the synth of the one after it, while the
// first still starts in seconds.
const RAMP = [220, 350, 500, 700, 1000];
const REST_MAX = 1200; // steady-state chunk once the buffer is built

/** Sentence-aware plan with ramped chunk sizes (small → large). */
function planChunks(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  const chunks: string[] = [];
  let cur = '';
  const limit = () => RAMP[chunks.length] ?? REST_MAX;
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
  const chunks = planChunks(speakableText(text));
  // The SHARED element: unlocked once via unlockAudio() (Audio Mode), and one
  // voice at a time — starting this read stops whichever one was playing.
  activeCtl?.stop();
  const audio = getSharedEl();
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

  const ctl: VoiceoverController = {
    stop: () => {
      stopped = true;
      ac.abort();
      if (activeCtl === ctl) activeCtl = null;
      try {
        audio.pause();
      } catch {
        /* already torn down */
      }
    }
  };
  activeCtl = ctl;
  return ctl;
}
