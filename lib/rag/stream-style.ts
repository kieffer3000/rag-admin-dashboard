'use client';

import { useSyncExternalStore } from 'react';

/**
 * How a streaming answer is *revealed* to the reader. Two looks, A/B-toggleable
 * live (the toggle sits in the dashboard header) so we can compare against the
 * real Anthropic streaming feel:
 *
 *  - 'word' : per-word fade — each newly revealed word materializes (opacity
 *             0→1, a slight rise, a touch of de-blur). The reveal cadence
 *             (streamText, word-boundary) staggers them into a gentle wave.
 *             Most faithful to Anthropic; prose renders near-plain WHILE
 *             streaming, then snaps to full formatting on completion.
 *  - 'mask' : a soft gradient mask on the leading edge over the live, fully
 *             formatted HTML/markdown. No end-of-stream reflow; the fade is an
 *             edge gradient rather than per-word opacity.
 *
 * Persisted to localStorage so the choice survives reloads. The store is a tiny
 * external store (useSyncExternalStore) so every AnswerBody + the toggle button
 * re-render the instant the style flips, even mid-stream.
 */
export type StreamStyle = 'word' | 'mask';

const KEY = 'cf_stream_style';
// Edge mask is the chosen default (formatted the whole way through, soft leading
// edge, no end-of-stream reflow). The per-word fade stays available via the
// header toggle for anyone who prefers it.
const DEFAULT: StreamStyle = 'mask';

function read(): StreamStyle {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const v = localStorage.getItem(KEY);
    return v === 'mask' || v === 'word' ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let current: StreamStyle = read();
const subs = new Set<() => void>();

export function getStreamStyle(): StreamStyle {
  return current;
}

export function setStreamStyle(next: StreamStyle): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  subs.forEach((cb) => cb());
}

export function useStreamStyle(): StreamStyle {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
    () => DEFAULT
  );
}
