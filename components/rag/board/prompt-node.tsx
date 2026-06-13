'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { Sparkles, Pencil } from 'lucide-react';
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
  const { updateBoardNodeData } = useBoard();
  const text = (d.text as string) || '';

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
          'relative flex items-center gap-2 overflow-hidden rounded-[11px] bg-indigo-50 px-3 ring-1 ring-indigo-200/60 dark:bg-indigo-500/[0.10] dark:ring-indigo-400/20',
          'shadow-[0_1px_2px_rgb(0_0_0/0.10)]',
          selected && 'ring-2 ring-indigo-400/70'
        )}
      >
        <span className="pointer-events-none absolute bottom-0 left-0 top-0 w-[3px] rounded-l-[11px] bg-indigo-500" />
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-indigo-500/80">
            Prompt
          </span>
          <span className="block truncate text-[11px] font-medium text-indigo-900/80 dark:text-indigo-200/80">
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
      className="group relative"
    >
      {/* puzzle body — indigo so it reads as an instruction, not a source */}
      <div
        style={{ width: CHIP_W, height: CHIP_H + CHIP_TAB, clipPath: CHIP_CLIP }}
        className="absolute inset-0 bg-indigo-50 dark:bg-[hsl(243_35%_16%)]"
      />
      <div
        style={{ clipPath: CHIP_CLIP, width: CHIP_W, height: CHIP_H + CHIP_TAB }}
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute bottom-0 left-0 top-0 w-[5px] bg-indigo-500" />
        <div className="absolute inset-0 bg-indigo-500 opacity-[0.04]" />
      </div>
      <div
        style={{ height: CHIP_H }}
        className="relative flex items-center gap-2 px-2.5 pt-1"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-indigo-500" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[9px] font-bold uppercase tracking-wide text-indigo-500/80">
            Prompt
          </div>
          <div className="line-clamp-1 text-[11.5px] font-medium text-indigo-900/85 dark:text-indigo-100/85">
            {text.trim() || 'click ✎ to write an instruction'}
          </div>
        </div>
        <button
          onClick={edit}
          title="Edit instruction"
          className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/70 text-indigo-500 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:bg-white/10"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-card !bg-indigo-500"
      />
    </div>
  );
}

export const PromptNode = memo(PromptNodeInner);
