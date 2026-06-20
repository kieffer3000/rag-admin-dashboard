'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { Bot, RotateCcw } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import { CHIP_W, CHIP_H, CHIP_TAB, type AgentData } from '@/lib/rag/board/types';

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

  // Free on the board → a ROBOT FACE, not a puzzle piece. A circular emerald
  // avatar (the Bot face, or the chosen emoji) with the persona's name beneath,
  // so an agent reads as a "who" answering, distinct from source/prompt chips.
  return (
    <div
      style={{ width: CHIP_W, height: CHIP_H + CHIP_TAB }}
      className="group relative flex flex-col items-center justify-center gap-2"
    >
      <div
        style={{
          filter: selected
            ? 'drop-shadow(0 0 0.5px hsl(var(--accent))) drop-shadow(0 2px 10px hsl(var(--accent)/0.5))'
            : 'drop-shadow(0 2px 6px rgb(16 185 129/0.30)) drop-shadow(0 1px 2px rgb(0 0 0/0.10))'
        }}
        className={cn(
          'relative flex h-[72px] w-[72px] items-center justify-center rounded-full',
          'bg-gradient-to-b from-emerald-400 to-emerald-600 text-white',
          'ring-4 ring-emerald-100 dark:ring-emerald-500/20',
          selected && 'ring-emerald-300 dark:ring-emerald-400/40'
        )}
      >
        {icon ? (
          <span className="text-[30px] leading-none">{icon}</span>
        ) : (
          <Bot className="h-9 w-9" strokeWidth={2.25} />
        )}
      </div>

      <div className="max-w-[150px] text-center leading-tight">
        <div className="text-[8.5px] font-bold uppercase tracking-wide text-emerald-600/80">
          Agent
        </div>
        <div className="line-clamp-1 text-[12px] font-semibold text-emerald-900/85 dark:text-emerald-100/90">
          {name}
        </div>
      </div>

      <button
        title="Remove from board"
        onClick={(e) => {
          e.stopPropagation();
          removeBoardNode(id);
        }}
        className="nodrag absolute -top-0.5 left-1/2 flex h-5 w-5 -translate-x-[44px] items-center justify-center rounded-full bg-card text-muted-foreground/60 opacity-0 shadow-[0_1px_4px_rgb(0_0_0/0.12)] transition-opacity hover:text-foreground group-hover:opacity-100"
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
