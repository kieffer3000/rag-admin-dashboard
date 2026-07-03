'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A small "?" that explains a feature in plain English on hover. The
 * concept-load rule (2026-07-03): sell the button, explain on demand, never
 * lecture. Used everywhere a power feature might puzzle a newcomer.
 *
 * Portalled tooltip (see components/ui/tooltip) so it escapes any board node /
 * dialog clip. Requires a TooltipProvider above it — the dashboard mounts one
 * globally in providers.tsx.
 */
export function HelpDot({
  text,
  side = 'bottom',
  className
}: {
  text: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}) {
  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="What is this?"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/50 transition-colors hover:text-accent',
            className
          )}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className="max-w-[340px] whitespace-pre-line py-2 text-[12.5px] leading-relaxed"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
