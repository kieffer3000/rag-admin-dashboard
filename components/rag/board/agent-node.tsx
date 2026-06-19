'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { Bot, RotateCcw } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import {
  CHIP_W,
  CHIP_H,
  CHIP_TAB,
  CHIP_CLIP,
  type AgentData
} from '@/lib/rag/board/types';

/**
 * An AGENT piece — a reusable ANSWERING PERSONA (a name + a robot icon + a
 * system prompt) that guides HOW a brain answers. Puzzle-shaped like a prompt
 * piece but emerald (a "persona", not a generic instruction or a source).
 * Wire one (or a box of them) into a brain and its system prompt rides into
 * the prompt as guidance. Never a source, never indexed, never the question.
 * Compact tile when docked inside a box.
 */
function AgentNodeInner({ id, data, selected, parentId }: NodeProps) {
  const d = data as AgentData;
  const { removeBoardNode } = useBoard();
  const name = (d.name as string)?.trim() || 'Agent';
  const icon = (d.icon as string) || '';

  // Docked in a box → compact persona tile that fits the grid.
  if (parentId) {
    return (
      <div
        style={{ width: CHIP_W, height: CHIP_H }}
        title={name}
        className={cn(
          'relative flex items-center gap-2 overflow-hidden rounded-[11px] bg-emerald-50 px-3 ring-1 ring-emerald-200/60 dark:bg-emerald-500/[0.10] dark:ring-emerald-400/20',
          'shadow-[0_1px_2px_rgb(0_0_0/0.10)]',
          selected && 'ring-2 ring-emerald-400/70'
        )}
      >
        <span className="pointer-events-none absolute bottom-0 left-0 top-0 w-[3px] rounded-l-[11px] bg-emerald-500" />
        {icon ? (
          <span className="shrink-0 text-[15px] leading-none">{icon}</span>
        ) : (
          <Bot className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        )}
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-emerald-600/80">
            Agent
          </span>
          <span className="block truncate text-[11px] font-medium text-emerald-900/80 dark:text-emerald-200/80">
            {name}
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
      {/* puzzle body — emerald so it reads as a persona, not a source */}
      <div
        style={{ width: CHIP_W, height: CHIP_H + CHIP_TAB, clipPath: CHIP_CLIP }}
        className="absolute inset-0 bg-emerald-50 dark:bg-[hsl(157_35%_13%)]"
      />
      <div
        style={{ clipPath: CHIP_CLIP, width: CHIP_W, height: CHIP_H + CHIP_TAB }}
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute bottom-0 left-0 top-0 w-[5px] bg-emerald-500" />
        <div className="absolute inset-0 bg-emerald-500 opacity-[0.04]" />
      </div>
      <div
        style={{ height: CHIP_H }}
        className="relative flex items-center gap-2 px-2.5 pt-1"
      >
        {icon ? (
          <span className="shrink-0 text-[18px] leading-none">{icon}</span>
        ) : (
          <Bot className="h-4 w-4 shrink-0 text-emerald-500" />
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-600/80">
            Agent
          </div>
          <div className="line-clamp-2 text-[11.5px] font-semibold leading-[1.18] text-emerald-900/85 dark:text-emerald-100/85">
            {name}
          </div>
        </div>
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
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-card !bg-emerald-500"
      />
    </div>
  );
}

export const AgentNode = memo(AgentNodeInner);
