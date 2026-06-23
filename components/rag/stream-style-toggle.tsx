'use client';

import { Sparkles, AlignLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStreamStyle, setStreamStyle } from '@/lib/rag/stream-style';

/**
 * Header toggle to A/B the answer streaming reveal style live (compare against
 * the real Anthropic feel). 'word' = per-word fade (most faithful); 'mask' =
 * leading-edge gradient over the live formatted render. See lib/rag/stream-style.
 */
export function StreamStyleToggle() {
  const style = useStreamStyle();
  const next = style === 'word' ? 'mask' : 'word';

  return (
    <button
      onClick={() => setStreamStyle(next)}
      title={`Streaming reveal: ${
        style === 'word' ? 'per-word fade' : 'edge mask'
      } — click for ${next === 'word' ? 'per-word fade' : 'edge mask'}`}
      aria-label="Toggle answer streaming style"
      className="flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
    >
      {style === 'word' ? (
        <Sparkles className="h-[15px] w-[15px] text-accent" />
      ) : (
        <AlignLeft className="h-[15px] w-[15px]" />
      )}
      <span className="hidden sm:inline">
        {style === 'word' ? 'Word fade' : 'Edge mask'}
      </span>
    </button>
  );
}
