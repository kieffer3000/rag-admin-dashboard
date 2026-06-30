'use client';

import { memo, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { GripHorizontal, Check } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import type { AnnotationData } from '@/lib/rag/board/types';

/** Sticky-note palette. The chosen key is stored in node.data.color so it
 *  persists with the board. */
const NOTE_COLORS: Record<
  string,
  { grip: string; body: string; text: string; ring: string; swatch: string }
> = {
  amber: {
    grip: 'bg-amber-200/80 dark:bg-amber-300/20',
    body: 'bg-amber-100/90 dark:bg-amber-300/[0.13]',
    text: 'text-amber-900 placeholder:text-amber-900/40 dark:text-amber-100',
    ring: 'ring-amber-400/70',
    swatch: 'bg-amber-300'
  },
  rose: {
    grip: 'bg-rose-200/80 dark:bg-rose-300/20',
    body: 'bg-rose-100/90 dark:bg-rose-300/[0.13]',
    text: 'text-rose-900 placeholder:text-rose-900/40 dark:text-rose-100',
    ring: 'ring-rose-400/70',
    swatch: 'bg-rose-300'
  },
  sky: {
    grip: 'bg-sky-200/80 dark:bg-sky-300/20',
    body: 'bg-sky-100/90 dark:bg-sky-300/[0.13]',
    text: 'text-sky-900 placeholder:text-sky-900/40 dark:text-sky-100',
    ring: 'ring-sky-400/70',
    swatch: 'bg-sky-300'
  },
  emerald: {
    grip: 'bg-emerald-200/80 dark:bg-emerald-300/20',
    body: 'bg-emerald-100/90 dark:bg-emerald-300/[0.13]',
    text: 'text-emerald-900 placeholder:text-emerald-900/40 dark:text-emerald-100',
    ring: 'ring-emerald-400/70',
    swatch: 'bg-emerald-300'
  },
  violet: {
    grip: 'bg-violet-200/80 dark:bg-violet-300/20',
    body: 'bg-violet-100/90 dark:bg-violet-300/[0.13]',
    text: 'text-violet-900 placeholder:text-violet-900/40 dark:text-violet-100',
    ring: 'ring-violet-400/70',
    swatch: 'bg-violet-300'
  },
  slate: {
    grip: 'bg-slate-200/90 dark:bg-slate-300/20',
    body: 'bg-slate-100/95 dark:bg-slate-300/[0.10]',
    text: 'text-slate-800 placeholder:text-slate-500 dark:text-slate-100',
    ring: 'ring-slate-400/70',
    swatch: 'bg-slate-300'
  }
};

/** Sticky note — purely visual, never wired, never queried. Drag by the
 *  header bar; drag the corners (when selected) to resize; colour persists. */
function AnnotationNodeInner({ id, data, selected }: NodeProps) {
  const d = data as AnnotationData & { color?: string };
  const { updateBoardNodeData } = useBoard();
  const [palette, setPalette] = useState(false);
  const c = NOTE_COLORS[d.color ?? 'amber'] ?? NOTE_COLORS.amber;

  return (
    <div
      className={cn(
        'flex h-full min-h-[110px] w-full min-w-[180px] flex-col overflow-hidden rounded-[14px] shadow-[0_2px_12px_rgb(0_0_0/0.10)]',
        c.body,
        selected && cn('ring-2', c.ring)
      )}
    >
      <NodeResizer
        minWidth={170}
        minHeight={90}
        isVisible={selected}
        lineClassName="!border-transparent"
        handleClassName="!h-2.5 !w-2.5 !rounded-full !border !border-white/70 !bg-black/30"
      />
      {/* header bar — grab here to MOVE the note (this is the drag handle) */}
      <div className={cn('relative flex h-6 shrink-0 items-center px-1.5', c.grip)}>
        <GripHorizontal className="h-3.5 w-3.5 text-black/30 dark:text-white/40" />
        <span className="ml-1 select-none text-[9px] font-semibold uppercase tracking-wide text-black/35 dark:text-white/40">
          note
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setPalette((p) => !p);
          }}
          title="Note colour"
          className={cn(
            'nodrag ml-auto h-3.5 w-3.5 rounded-full ring-1 ring-black/10',
            c.swatch
          )}
        />
        {palette && (
          <div className="nodrag absolute right-1 top-7 z-10 flex gap-1 rounded-full bg-card p-1 shadow-[0_2px_10px_rgb(0_0_0/0.18)]">
            {Object.entries(NOTE_COLORS).map(([key, v]) => (
              <button
                key={key}
                onClick={(e) => {
                  e.stopPropagation();
                  updateBoardNodeData(id, { color: key });
                  setPalette(false);
                }}
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-black/10',
                  v.swatch
                )}
              >
                {(d.color ?? 'amber') === key && (
                  <Check className="h-2.5 w-2.5 text-black/60" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      <textarea
        value={d.text}
        onChange={(e) => updateBoardNodeData(id, { text: e.target.value })}
        placeholder="Note to self…"
        className={cn(
          'nodrag nowheel block min-h-0 w-full flex-1 resize-none overflow-y-auto bg-transparent px-2.5 py-2 text-[12.5px] leading-[1.55] outline-none',
          c.text
        )}
      />
    </div>
  );
}

export const AnnotationNode = memo(AnnotationNodeInner);
