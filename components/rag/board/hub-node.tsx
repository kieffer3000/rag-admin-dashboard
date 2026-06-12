'use client';

import { memo, useState } from 'react';
import { Handle, Position, useStore, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import {
  hubSize,
  hubSlot,
  CHIP_W,
  CHIP_H,
  HUB_HEADER_H,
  HUB_COLS,
  type HubData
} from '@/lib/rag/board/types';
import { MediaType } from '@/lib/rag/types';
import { MediaIcon } from '@/components/rag/shared';
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

  // Open "parking spaces" in the grid — dashed ghost tiles that say "drop
  // pieces here" without words. Empty tray shows a full first row; otherwise
  // the trailing open column of the current last row.
  const ghostSlots: number[] = everything
    ? []
    : memberCount === 0
    ? Array.from({ length: HUB_COLS }, (_, i) => i)
    : memberCount % HUB_COLS !== 0
    ? [memberCount]
    : [];

  function commitName(next: string) {
    const name = next.trim();
    if (name && name !== d.name) updateBoardNodeData(id, { name });
    setEditing(false);
  }

  return (
    <div
      style={size}
      className={cn(
        // The tray BODY is a bezel/lip flush with the desk: frosted white,
        // a crisp ultra-fine outer border, a gentle raise. The recess lives
        // in the inner WELL below (separate, darker surface).
        'relative rounded-[18px] backdrop-blur-xl transition-all',
        everything
          ? 'bg-gradient-to-br from-indigo-500/[0.09] to-violet-500/[0.13] ring-1 ring-accent/25'
          : 'bg-white/72 ring-1 ring-black/[0.07] shadow-[0_1px_2px_rgb(0_0_0/0.04),0_6px_20px_-8px_rgb(0_0_0/0.12)] dark:bg-white/[0.045] dark:ring-white/[0.08]',
        selected && 'ring-2 ring-accent/55',
        d.glow && 'ring-2 ring-accent shadow-[0_0_0_5px_hsl(var(--accent)/0.14)]'
      )}
    >
      {/* the recessed WELL — a distinct cool-gray surface cut into the body,
          with the inset shadow ONLY here so the dish depth is unmistakable.
          Docked chip tiles (RF children) render on top of it. */}
      {!everything && (
        <div
          style={{ top: HUB_HEADER_H - 2 }}
          className={cn(
            'pointer-events-none absolute inset-x-1.5 bottom-1.5 overflow-hidden rounded-[13px] bg-[#eef1f5] shadow-[inset_0_2px_6px_rgb(0_0_0/0.10),inset_0_0_0_1px_rgb(0_0_0/0.03)] dark:bg-black/30 dark:shadow-[inset_0_2px_8px_rgb(0_0_0/0.55)]'
          )}
        >
          {/* magnetic drag-over: the well floods with the accent hue */}
          <div
            className={cn(
              'absolute inset-0 transition-opacity duration-200',
              cluster ? 'bg-accent' : meta!.solid,
              d.glow ? 'opacity-[0.12]' : 'opacity-0'
            )}
          />
          {/* ghost "parking spaces" — dashed empty tiles invite a drop */}
          {ghostSlots.map((i) => {
            const slot = hubSlot(i);
            return (
              <div
                key={i}
                style={{
                  left: slot.x - 6, // well is inset 6px from the body
                  top: slot.y - (HUB_HEADER_H - 2),
                  width: CHIP_W,
                  height: CHIP_H
                }}
                className="absolute rounded-[11px] border border-dashed border-black/15 dark:border-white/15"
              />
            );
          })}
        </div>
      )}

      {/* rim header — the box's grab handle / lip; a hairline divider separates
          it from the recessed well below */}
      <div className="relative flex h-[42px] cursor-grab items-center gap-2 border-b border-black/[0.06] px-3 active:cursor-grabbing dark:border-white/[0.06]">
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
            className="min-w-0 flex-1 select-none truncate text-[12px] font-semibold tracking-tight"
          >
            {d.name}
          </span>
        )}
        {/* family portrait: a mini media icon per type living in this cluster */}
        {cluster && memberTypes.length > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            {memberTypes.slice(0, 5).map((t) => (
              <span
                key={t}
                title={MEDIA_TYPES[t].plural}
                className={cn(
                  'flex h-[18px] w-[18px] items-center justify-center rounded-md',
                  MEDIA_TYPES[t].tint,
                  MEDIA_TYPES[t].text
                )}
              >
                <MediaIcon type={t} size="sm" className="h-3 w-3" />
              </span>
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
        /* empty tray: a caption floats over the parking-space ghosts */
        <span
          style={{ top: HUB_HEADER_H + 26 }}
          className="pointer-events-none absolute inset-x-0 text-center text-[10.5px] font-medium text-muted-foreground/60"
        >
          {cluster
            ? 'drop any pieces here'
            : `drag ${meta!.plural.toLowerCase()} here to dock`}
        </span>
      ) : null}

      {/* THE plug — a pronounced, MOLDED pill-shaped lug: a vertical gradient
          + a top inner-highlight give it cylindrical volume, like a rubberized
          port protruding from the tray's side (vs a piece's tiny dot) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-6 !w-3 !-right-1.5 !rounded-full !border !border-black/10 !bg-gradient-to-b !from-indigo-400 !to-violet-600 !shadow-[inset_0_1px_0_rgb(255_255_255/0.55),0_1px_4px_hsl(var(--accent)/0.5)]"
      />
    </div>
  );
}

export const HubNode = memo(HubNodeInner);
