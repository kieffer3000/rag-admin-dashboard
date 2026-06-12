'use client';

// Board sound design — synthesized with WebAudio, zero audio assets.
// Physical metaphors feel real when they're audible: a wooden clack when
// puzzle pieces weld, a muted hum while a brain thinks, an airy chime when
// an answer lands. Everything is QUIET by design and one toggle away from
// silent (persisted in localStorage). AudioContext is created lazily on the
// first user-gesture-driven sound, so autoplay policies never bite.

let ctx: AudioContext | null = null;
let muted: boolean | null = null;

const LS_KEY = 'board_sound';

export function soundEnabled(): boolean {
  if (muted === null) {
    try {
      muted = localStorage.getItem(LS_KEY) === 'off';
    } catch {
      muted = false;
    }
  }
  return !muted;
}

export function setSoundEnabled(on: boolean) {
  muted = !on;
  try {
    localStorage.setItem(LS_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode — session-only toggle */
  }
  if (!on) killHum();
}

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Soft wooden "clack" — puzzle pieces snapping into a weld. */
export function playSnap() {
  if (!soundEnabled()) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime;

  // Low thump (the mass landing)…
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(185, t);
  o.frequency.exponentialRampToValueAtTime(72, t + 0.07);
  g.gain.setValueAtTime(0.14, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.11);

  // …plus a short woody click (band-passed noise burst).
  const len = Math.floor(c.sampleRate * 0.03);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1900;
  f.Q.value = 1.1;
  const ng = c.createGain();
  ng.gain.value = 0.09;
  src.connect(f).connect(ng).connect(c.destination);
  src.start(t);
}

/** Elastic pop — a piece yanked free of its stack. */
export function playPop() {
  if (!soundEnabled()) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(290, t);
  o.frequency.exponentialRampToValueAtTime(560, t + 0.07);
  g.gain.setValueAtTime(0.1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.13);
}

// ---- thinking hum (refcounted: several brains can think at once) ----
let hum: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode } | null = null;
let humCount = 0;

/** Muted low-frequency hum while a brain processes. */
export function startHum() {
  humCount++;
  if (hum || !soundEnabled()) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const o1 = c.createOscillator();
  const o2 = c.createOscillator();
  const g = c.createGain();
  o1.type = 'sine';
  o1.frequency.value = 54;
  o2.type = 'sine';
  o2.frequency.value = 54.8; // slight detune → slow organic beat
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.012, t + 0.6);
  o1.connect(g);
  o2.connect(g);
  g.connect(c.destination);
  o1.start(t);
  o2.start(t);
  hum = { o1, o2, g };
}

export function stopHum() {
  humCount = Math.max(0, humCount - 1);
  if (humCount === 0) killHum();
}

function killHum() {
  if (!hum || !ctx) {
    hum = null;
    return;
  }
  const t = ctx.currentTime;
  hum.g.gain.cancelScheduledValues(t);
  hum.g.gain.setValueAtTime(Math.max(hum.g.gain.value, 0.0001), t);
  hum.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  hum.o1.stop(t + 0.4);
  hum.o2.stop(t + 0.4);
  hum = null;
}

/** Light, airy two-note chime — an answer completed. */
export function playChime() {
  if (!soundEnabled()) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  for (const [freq, at, vol] of [
    [880, 0, 0.045], // A5
    [1318.5, 0.09, 0.04] // E6
  ] as const) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(vol, t + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.7);
    o.connect(g).connect(c.destination);
    o.start(t + at);
    o.stop(t + at + 0.75);
  }
}
