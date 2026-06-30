'use client';

import { memo } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { BookOpen, X } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import { CHIP_W, CHIP_H, type ReferenceData } from '@/lib/rag/board/types';

/**
 * REFERENCE (top plug) — an exemplar to imitate or a clue to consider ("make it
 * like this", "weigh these leads"). Guides Opine judgment WITHOUT being a source:
 * carried whole, NEVER indexed and never cited. Several may be wired to one brain.
 */
function ReferenceNodeInner({ id, data, selected, parentId }: NodeProps) {
  const d = data as ReferenceData;
  const { updateBoardNodeData, removeBoardNode } = useBoard();

  if (parentId) {
    return (
      <div
        style={{ width: CHIP_W, height: CHIP_H }}
        title={d.title || 'Example'}
        className={cn(
          'relative flex items-center gap-2 overflow-hidden rounded-[11px] bg-card px-3 ring-1 ring-black/[0.04] dark:ring-white/[0.06]',
          'shadow-[0_1px_2px_rgb(0_0_0/0.10)]',
          selected && 'ring-2 ring-violet-400/60'
        )}
      >
        <span className="pointer-events-none absolute bottom-0 left-0 top-0 w-[3px] rounded-l-[11px] bg-violet-500" />
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-violet-600" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[11px] font-semibold text-violet-700 dark:text-violet-400">
            Example
          </span>
          <span className="block truncate text-[10px] text-muted-foreground/70">
            {d.title?.trim() || d.content?.trim()?.slice(0, 40) || 'empty'}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-[130px] w-full min-w-[200px] flex-col overflow-hidden rounded-[16px] bg-card',
        'shadow-[0_1px_3px_rgb(0_0_0/0.05),0_8px_24px_rgb(0_0_0/0.06)]',
        'dark:ring-1 dark:ring-white/[0.07]',
        selected && 'ring-2 ring-violet-400/60'
      )}
    >
      <NodeResizer
        minWidth={190}
        minHeight={120}
        isVisible={selected}
        lineClassName="!border-violet-400/40"
        handleClassName="!h-2.5 !w-2.5 !rounded-full !border !border-white/70 !bg-violet-500"
      />
      <div className="flex shrink-0 cursor-grab items-center gap-1.5 bg-violet-500/[0.08] px-3 py-1.5 active:cursor-grabbing">
        <BookOpen className="h-3 w-3 text-violet-600" />
        <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-400">
          Example
        </span>
        <span className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground/50">
          example · not indexed
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeBoardNode(id);
          }}
          title="Remove this reference"
          className="nodrag ml-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-500"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        value={d.title ?? ''}
        onChange={(e) => updateBoardNodeData(id, { title: e.target.value })}
        placeholder="Label (e.g. Gary Halbert sales letter)"
        className="nodrag block w-full shrink-0 border-b border-black/[0.04] bg-transparent px-3 py-1.5 text-[12px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/40 dark:border-white/[0.06]"
      />
      <textarea
        value={d.content ?? ''}
        onChange={(e) => updateBoardNodeData(id, { content: e.target.value })}
        placeholder="Paste the example / template / clue to steer the Answers Bank by…"
        className="nodrag nowheel block min-h-0 w-full flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2 text-[12px] leading-relaxed outline-none placeholder:text-muted-foreground/40"
      />
      {/* Connector on the LEFT — references sit to the right of the brain. */}
      <Handle
        type="source"
        position={Position.Left}
        className="!h-4 !w-4 !border-2 !border-card !bg-violet-500"
      />
    </div>
  );
}

export const ReferenceNode = memo(ReferenceNodeInner);
