'use client';

import { memo, useState } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import {
  hubSize,
  CHIP_W,
  CHIP_H,
  CHIP_TAB,
  CHIP_CLIP,
  type HubData
} from '@/lib/rag/board/types';
import { MediaType } from '@/lib/rag/types';
import { Sparkles, Puzzle } from 'lucide-react';
import { useRag } from '@/lib/rag/store';
import { useBoard } from '@/lib/rag/board/store';

/**
 * The BOX — a puzzle TRAY. Not a media-type bin: a user-named cluster of
 * intelligence (a sub-project — "SEO", "PPC", "Conference 2026") that holds
 * ANY mix of pieces. Pieces sit recessed in the tray's well; the tray has ONE
 * plug on its rim. Wire the tray to a brain and the whole family is queried
 * together; unplug it and the whole family goes silent. Double-click the
 * name to rename. (Legacy single-type hubs still render; the "everything"
 * variant implicitly carries ALL indexed project sources.)
 */
function HubNodeInner({ id, data, selected }: NodeProps) {
  const d = data as HubData;
  const { projectMedia, media } = useRag();
  const { updateBoardNodeData } = useBoard();
  const [editing, setEditing] = useState(false);

  // Docked members (joined ids keep the selector's equality check cheap).
  const memberIdsKey = useStore((s) =>
    d.mediaType === 'everything'
      ? ''
      : s.nodes
          .filter((n) => n.parentId === id)
          .map((n) => (n.data as any).mediaId as string)
          .join('|')
  );
  const memberIds = memberIdsKey ? memberIdsKey.split('|') : [];
  const memberCount = memberIds.length;
  /** Distinct media types inside — the tray's "family portrait" dots. */
  const memberTypes = [
    ...new Set(
      memberIds
        .map((mid) => media.find((m) => m.id === mid)?.type)
        .filter(Boolean) as MediaType[]
    )
  ];

  const everything = d.mediaType === 'everything';
  const cluster = d.mediaType === 'cluster';
  const meta =
    everything || cluster ? null : MEDIA_TYPES[d.mediaType as MediaType];
  const Icon = everything ? Sparkles : cluster ? Puzzle : meta!.icon;
  const size = everything ? { width: 230, height: 86 } : hubSize(memberCount);
  const indexedAll = projectMedia.filter((m) => m.status === 'indexed').length;

  function commitName(next: string) {
    const name = next.trim();
    if (name && name !== d.name) updateBoardNodeData(id, { name });
    setEditing(false);
  }

  return (
    <div
      style={size}
      className={cn(
        // Glassmorphic tray: translucent, frosted, resting ON the dot grid.
        'relative rounded-[18px] backdrop-blur-xl transition-all',
        everything
          ? 'bg-gradient-to-br from-indigo-500/[0.09] to-violet-500/[0.13] ring-1 ring-accent/25'
          : 'bg-white/55 ring-1 ring-white/40 shadow-[0_1px_3px_rgb(0_0_0/0.04),0_8px_28px_rgb(0_0_0/0.05)] dark:bg-white/[0.045] dark:ring-white/[0.08]',
        selected && 'ring-2 ring-accent/60',
        d.glow &&
          'ring-2 ring-accent shadow-[0_0_0_5px_hsl(var(--accent)/0.14),0_8px_28px_rgb(0_0_0/0.08)]'
      )}
    >
      {/* magnetic drag-over: the tray lights up from within */}
      {!everything && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 rounded-[18px] transition-opacity duration-200',
            cluster ? 'bg-accent' : meta!.solid,
            d.glow ? 'opacity-[0.10]' : 'opacity-0'
          )}
        />
      )}

      {/* recessed WELL — pieces visibly seat INTO the tray, not onto a card */}
      {!everything && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 top-[40px] rounded-[13px] bg-black/[0.035] shadow-[inset_0_2px_5px_rgb(0_0_0/0.07),inset_0_0_0_1px_rgb(0_0_0/0.025)] dark:bg-black/[0.22] dark:shadow-[inset_0_2px_6px_rgb(0_0_0/0.45),inset_0_0_0_1px_rgb(255_255_255/0.03)]" />
      )}

      {/* rim header */}
      <div className="relative flex h-[42px] items-center gap-2 px-3">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg',
            everything || cluster
              ? 'bg-accent/15 text-accent'
              : cn(meta!.tint, meta!.text)
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
        </span>
        {editing ? (
          <input
            autoFocus
            defaultValue={d.name}
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="nodrag min-w-0 flex-1 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[12px] font-semibold tracking-tight outline-none ring-1 ring-accent/40 dark:bg-white/[0.07]"
          />
        ) : (
          <span
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="min-w-0 flex-1 cursor-text truncate text-[12px] font-semibold tracking-tight"
          >
            {d.name}
          </span>
        )}
        {/* family portrait: one dot per media type living in this cluster */}
        {cluster && memberTypes.length > 0 && (
          <span className="flex shrink-0 items-center gap-[3px]">
            {memberTypes.slice(0, 5).map((t) => (
              <span
                key={t}
                title={MEDIA_TYPES[t].plural}
                className={cn('h-1.5 w-1.5 rounded-full', MEDIA_TYPES[t].solid)}
              />
            ))}
          </span>
        )}
        <span className="shrink-0 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-white/[0.07]">
          {everything ? `${indexedAll} sources` : memberCount}
        </span>
      </div>

      {everything ? (
        <div className="px-3 text-[10.5px] leading-snug text-muted-foreground/70">
          Wires every indexed source in this project to the brain.
        </div>
      ) : memberCount === 0 ? (
        /* empty tray: a ghost piece shows exactly what seats here */
        <div className="relative flex flex-col items-center justify-center pt-2.5">
          <div
            style={{
              width: CHIP_W,
              height: CHIP_H + CHIP_TAB,
              clipPath: CHIP_CLIP
            }}
            className="bg-black/[0.05] dark:bg-white/[0.05]"
          />
          <span className="pointer-events-none absolute inset-x-0 top-[24px] text-center text-[10.5px] text-muted-foreground/55">
            {cluster
              ? 'drop any pieces here'
              : `drag ${meta!.plural.toLowerCase()} here to dock`}
          </span>
        </div>
      ) : null}

      {/* THE plug — the one wiring point for the whole family */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-card !bg-accent"
      />
    </div>
  );
}

export const HubNode = memo(HubNodeInner);
