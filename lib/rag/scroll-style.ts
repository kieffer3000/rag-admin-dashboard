'use client';

import { useSyncExternalStore } from 'react';

/**
 * How the answer pane follows new content as it streams. A/B-toggleable live
 * (header toggle), same pattern as stream-style:
 *
 *  - 'smooth' : smooth-scroll to the newest answer (pretty when idle; can
 *               "earthquake" during streaming since it fires every frame).
 *  - 'pin'    : instant pin to the bottom, but ONLY when you're already near
 *               the bottom — so streaming never jitters and scrolling up to
 *               re-read isn't overridden (the committed 1da0ac0 behavior).
 *
 * Persisted to localStorage; tiny external store so both the board brain and the
 * research overlay re-read it the moment it flips.
 */
export type ScrollStyle = 'smooth' | 'pin';

const KEY = 'cf_scroll_style';
const DEFAULT: ScrollStyle = 'smooth';

function read(): ScrollStyle {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const v = localStorage.getItem(KEY);
    return v === 'pin' || v === 'smooth' ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let current: ScrollStyle = read();
const subs = new Set<() => void>();

export function getScrollStyle(): ScrollStyle {
  return current;
}

export function setScrollStyle(next: ScrollStyle): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  subs.forEach((cb) => cb());
}

export function useScrollStyle(): ScrollStyle {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => current,
    () => DEFAULT
  );
}
