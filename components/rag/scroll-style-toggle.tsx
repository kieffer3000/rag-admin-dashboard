'use client';

import { MoveVertical, ArrowDownToLine } from 'lucide-react';
import { useScrollStyle, setScrollStyle } from '@/lib/rag/scroll-style';

/**
 * Header toggle to A/B the answer-follow scroll behavior live: 'smooth' (glide
 * to newest) vs 'pin' (instant, guarded near-bottom). See lib/rag/scroll-style.
 */
export function ScrollStyleToggle() {
  const style = useScrollStyle();
  const next = style === 'smooth' ? 'pin' : 'smooth';

  return (
    <button
      onClick={() => setScrollStyle(next)}
      title={`Scroll: ${
        style === 'smooth' ? 'smooth glide' : 'pin to bottom'
      } — click for ${next === 'smooth' ? 'smooth glide' : 'pin to bottom'}`}
      aria-label="Toggle answer scroll behavior"
      className="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
    >
      {style === 'smooth' ? (
        <MoveVertical className="h-[15px] w-[15px] text-accent" />
      ) : (
        <ArrowDownToLine className="h-[15px] w-[15px]" />
      )}
      <span className="hidden sm:inline">
        {style === 'smooth' ? 'Smooth' : 'Pin'}
      </span>
    </button>
  );
}
