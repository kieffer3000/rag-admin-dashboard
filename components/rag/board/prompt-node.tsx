'use client';

import { memo } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { MessageSquareQuote, Pencil, RotateCcw } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import {
  CHIP_W,
  CHIP_H,
  CHIP_TAB,
  CHIP_CLIP,
  type PromptData
} from '@/lib/rag/board/types';

/**
 * A PROMPT piece — a reusable instruction that guides HOW a brain answers.
 * Puzzle-shaped like a source chip but indigo (an "instruction", not a
 * source). Wire one (or several / a box of them) into a brain and each rides
 * into the prompt as guidance. Never a source, never indexed, never shown as
 * the question. Compact tile when docked inside a box.
 */
function PromptNodeInner({ id, data, selected, parentId }: NodeProps) {
  const d = data as PromptData;
  const { updateBoardNodeData, removeBoardNode } = useBoard();
  const text = (d.text as string) || '';

  // Duplicate = the same instruction text already exists on an earlier prompt
  // piece (a brain dedupes guides, so copies are redundant) → dimmed.
  const duplicate = useStore((s) => {
    const t = text.trim();
    if (!t) return false;
    const same = s.nodes.filter(
      (n) => n.type === 'prompt' && ((n.data as any).text || '').trim() === t
    );
    return same.length > 1 && same[0].id !== id;
  });

  function edit(e: React.MouseEvent) {
    e.stopPropagation();
    const next = window.prompt('Instruction for the brain:', text);
    if (next !== null) updateBoardNodeData(id, { text: next });
  }

  // Docked in a box → compact instruction tile that fits the grid.
  if (parentId) {
    return (
      <div
        style={{ width: CHIP_W, height: CHIP_H }}
        title={text || 'Prompt'}
        className={cn(
          'relative flex items-center gap-2 overflow-hidden rounded-[11px] bg-accent/[0.08] px-3 ring-1 ring-accent/60 dark:bg-accent/[0.10] dark:ring-accent/20',
          'shadow-[0_1px_2px_rgb(0_0_0/0.10)]',
          selected && 'ring-2 ring-accent/70'
        )}
      >
        <span className="pointer-events-none absolute bottom-0 left-0 top-0 w-[3px] rounded-l-[11px] bg-accent" />
        <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-accent/80">
            Prompt
          </span>
          <span className="block truncate text-[11px] font-medium text-foreground/80 dark:text-foreground/80">
            {text.trim() || 'click ✎ to write'}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        width: CHIP_W,
        height: CHIP_H + CHIP_TAB,
        filter: selected
          ? 'drop-shadow(0 0 0.5px hsl(var(--accent))) drop-shadow(0 2px 8px hsl(var(--accent)/0.45))'
          : 'drop-shadow(0 1px 2px rgb(0 0 0/0.08)) drop-shadow(0 4px 10px rgb(0 0 0/0.07))'
      }}
      className={cn('group relative', duplicate && 'opacity-55 grayscale')}
    >
      {duplicate && (
        <span
          title="Duplicate instruction — already on the board. A brain applies it once."
          className="absolute -right-1.5 -top-1.5 z-10 rounded-full bg-foreground/70 px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wide text-background"
        >
          dup
        </span>
      )}
      {/* puzzle body — indigo so it reads as an instruction, not a source */}
      <div
        style={{ width: CHIP_W, height: CHIP_H + CHIP_TAB, clipPath: CHIP_CLIP }}
        className="absolute inset-0 bg-accent/[0.08] dark:bg-accent/[0.12]"
      />
      <div
        style={{ clipPath: CHIP_CLIP, width: CHIP_W, height: CHIP_H + CHIP_TAB }}
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute bottom-0 left-0 top-0 w-[5px] bg-accent" />
        <div className="absolute inset-0 bg-accent opacity-[0.04]" />
      </div>
      <div
        style={{ height: CHIP_H }}
        className="relative flex items-center gap-2 px-2.5 pt-1"
      >
        <MessageSquareQuote className="h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[9px] font-bold uppercase tracking-wide text-accent/80">
            Prompt
          </div>
          <div className="line-clamp-2 text-[11.5px] font-medium leading-[1.18] text-foreground/85 dark:text-foreground/85">
            {text.trim() || 'click ✎ to write an instruction'}
          </div>
        </div>
        <button
          onClick={edit}
          title="Edit instruction"
          className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/70 text-accent opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:bg-white/10"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>

      <button
        title="Remove from board"
        onClick={(e) => {
          e.stopPropagation();
          removeBoardNode(id);
        }}
        className="nodrag absolute -bottom-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted-foreground/60 opacity-0 shadow-[0_1px_4px_rgb(0_0_0/0.12)] transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        <RotateCcw className="h-2.5 w-2.5" />
      </button>

      <Handle
        type="source"
        position={Position.Left}
        className="!h-4 !w-4 !border-2 !border-card !bg-accent"
      />
    </div>
  );
}

export const PromptNode = memo(PromptNodeInner);
