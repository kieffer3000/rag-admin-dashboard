'use client';

import { useEffect, useState, type MutableRefObject } from 'react';

/**
 * FLICKER PROBE — the measure-first tool for the long-standing "board jitters/
 * flashes" report. Append `?probe=1` to the URL and a small pill appears with
 * LIVE numbers: how many times the canvas re-rendered in the last second and
 * how big the board is. Jitter theories so far (store updates re-rendering the
 * whole canvas through context; save machinery marking dirty) have never been
 * MEASURED in the wild — this pill turns "it flashes a lot" into a number we
 * can act on. Renders nothing at all without the flag.
 */
export function RenderProbe({
  counter,
  stats
}: {
  /** Incremented once per parent (canvas) render. */
  counter: MutableRefObject<number>;
  /** Refreshed each parent render with a short board-size string. */
  stats: MutableRefObject<string>;
}) {
  const [on, setOn] = useState(false);
  const [line, setLine] = useState('measuring…');
  const [peak, setPeak] = useState(0);

  useEffect(() => {
    if (!window.location.search.includes('probe=1')) return;
    setOn(true);
    let last = counter.current;
    let peakSeen = 0;
    const iv = setInterval(() => {
      const now = counter.current;
      const perSec = now - last;
      last = now;
      if (perSec > peakSeen) {
        peakSeen = perSec;
        setPeak(peakSeen);
      }
      setLine(`${perSec} renders/s · ${stats.current}`);
    }, 1000);
    return () => clearInterval(iv);
  }, [counter, stats]);

  if (!on) return null;
  return (
    <div className="pointer-events-none fixed bottom-3 left-1/2 z-[9999] -translate-x-1/2 rounded-full bg-black/85 px-3.5 py-1.5 font-mono text-[11px] leading-none text-lime-300 shadow-lg">
      {line} · peak {peak}/s
    </div>
  );
}
