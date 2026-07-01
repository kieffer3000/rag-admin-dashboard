'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { Bot, Pencil, Trash2 } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import { CHIP_W, CHIP_H, AGENT_W, AGENT_H, type AgentData } from '@/lib/rag/board/types';

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
  const { setAgentEditor, setPendingDelete } = useBoard();
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
        {d.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={d.avatar}
            alt=""
            draggable={false}
            className="h-5 w-5 shrink-0 rounded-full object-cover"
          />
        ) : icon ? (
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
      style={{ width: AGENT_W, height: AGENT_H }}
      // pointer-events-none on the OUTER box: the box is mostly transparent, and
      // when it overlaps other pieces a solid hit-box would steal their clicks
      // (you couldn't grab a chip sitting under the robot). Only the robot, name,
      // handle and button opt back IN — so the empty margins are click-through.
      className="pointer-events-none relative flex flex-col items-center justify-center gap-1.5"
    >
      {/* Transparent robot — no card/box, just the graphic floating on the
          canvas (like a sticker PNG). This is the grab/drag surface. */}
      <div
        className="group pointer-events-auto relative"
        style={{
          filter: selected
            ? 'drop-shadow(0 0 1px hsl(var(--accent))) drop-shadow(0 3px 10px hsl(var(--accent)/0.55))'
            : 'drop-shadow(0 3px 6px rgb(16 185 129/0.40)) drop-shadow(0 1px 2px rgb(0 0 0/0.18))'
        }}
      >
        {d.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={d.avatar}
            alt=""
            draggable={false}
            className="block h-32 w-32 select-none object-contain"
          />
        ) : icon ? (
          <span className="block select-none text-[120px] leading-none">{icon}</span>
        ) : (
          <Bot className="h-32 w-32 text-emerald-500" strokeWidth={1.6} />
        )}

        {/* Edit (improve the prompt) + Delete (asks to confirm). Also on
            right-click → context menu. */}
        <div className="nodrag absolute -right-1 -top-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            title="Edit agent"
            onClick={(e) => {
              e.stopPropagation();
              setAgentEditor(id);
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted-foreground/60 shadow-[0_1px_4px_rgb(0_0_0/0.12)] transition-colors hover:text-foreground"
          >
            <Pencil className="h-2.5 w-2.5" />
          </button>
          <button
            title="Delete agent"
            onClick={(e) => {
              e.stopPropagation();
              setPendingDelete(id);
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted-foreground/60 shadow-[0_1px_4px_rgb(0_0_0/0.12)] transition-colors hover:text-red-500"
          >
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      </div>

      <div className="pointer-events-auto mt-1 flex items-center justify-center">
        <span className="inline-flex max-w-[150px] truncate rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-600 ring-1 ring-emerald-500/20 backdrop-blur-sm dark:bg-emerald-500/20 dark:text-emerald-300">
          {name}
        </span>
      </div>

      {/* Connector on the node's RIGHT EDGE so nothing sits over the edge's cut
          point. pointer-events-auto so it's still draggable for wiring. */}
      <Handle
        type="source"
        position={Position.Left}
        className="pointer-events-auto !h-4 !w-4 !border-2 !border-card !bg-emerald-500"
      />
    </div>
  );
}

export const AgentNode = memo(AgentNodeInner);
