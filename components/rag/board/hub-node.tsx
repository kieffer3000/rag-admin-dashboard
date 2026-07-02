'use client';

import { memo, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import {
  hubSize,
  hubSlot,
  hubCols,
  hubCollapsed,
  hubUsesGrid,
  hubGridExpanded,
  HUB_MINI_SIZE,
  HUB_EXPANDED_SIZE,
  CHIP_W,
  CHIP_H,
  HUB_HEADER_H,
  type HubData
} from '@/lib/rag/board/types';
import { MediaType } from '@/lib/rag/types';
import { MediaIcon } from '@/components/rag/shared';
import {
  Sparkles,
  Puzzle,
  X,
  ChevronUp,
  ChevronDown,
  ExternalLink,
  ArrowUpRight,
  Trash2,
  Minus
} from 'lucide-react';
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
  const { projectMedia, media, deleteMedia } = useRag();
  const { board, updateBoardNodeData, removeBoardNode, toggleHubCollapse, undockMember, stashBox } =
    useBoard();
  const [editing, setEditing] = useState(false);
  // Grid virtualization: render ONLY the rows in view (a 3000-tile box would
  // otherwise mount 3000 <img> nodes at once and hang the tab).
  const [scrollTop, setScrollTop] = useState(0);
  // O(1) media lookups for tiles (avoid an O(n) find per tile across 1000s).
  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  // Docked members from the BOARD store (not React Flow's) so the hub re-renders
  // only when nodes actually change — NOT on every viewport pan/zoom frame, which
  // (with thousands of members) was rebuilding a huge string per frame and made
  // the canvas flicker during the load fit animation.
  const members = useMemo(
    () =>
      d.mediaType === 'everything'
        ? ([] as { nodeId: string; nodeType: string; mediaId: string }[])
        : board.nodes
            .filter((n) => n.parentId === id)
            .map((n) => ({
              nodeId: n.id,
              nodeType: (n.type ?? '') as string,
              mediaId: ((n.data as { mediaId?: string }).mediaId ?? '') as string
            })),
    [board.nodes, id, d.mediaType]
  );
  const memberIds = members.map((m) => m.mediaId).filter(Boolean);
  const memberCount = members.length;
  /** Distinct media types inside — the tray's "family portrait" dots. */
  const memberTypes = [
    ...new Set(
      memberIds
        .map((mid) => mediaById.get(mid)?.type)
        .filter(Boolean) as MediaType[]
    )
  ];

  const everything = d.mediaType === 'everything';
  const cluster = d.mediaType === 'cluster';
  const meta =
    everything || cluster ? null : MEDIA_TYPES[d.mediaType as MediaType];
  const Icon = everything ? Sparkles : cluster ? Puzzle : meta!.icon;
  // Minimized box: render members as a scrollable thumbnail grid in the hub's
  // OWN DOM (not as canvas child nodes) so a 100-item box stays a tidy fixed
  // preview instead of an enormous object that flickers / flies away. Big boxes
  // minimize automatically (hubCollapsed); the ▲/▼ button forces either state.
  const collapsed = hubCollapsed(d, memberCount);
  // Big boxes ALWAYS render the fixed, scrollable DOM grid (never an unbounded
  // wall of canvas tiles): "normal" = mini (~9 visible), "expanded" = ~2x +
  // scroll. Only small boxes use the draggable canvas grid.
  const usesGrid = hubUsesGrid(d, memberCount);
  const gridExpanded = hubGridExpanded(d, memberCount);
  const size = everything
    ? { width: 230, height: 86 }
    : usesGrid
    ? gridExpanded
      ? { ...HUB_EXPANDED_SIZE }
      : { ...HUB_MINI_SIZE }
    : hubSize(memberCount);
  const cols = hubCols(memberCount);

  // Virtualized DOM-grid window — fixed-height tiles make the math deterministic.
  // Only the rows intersecting the viewport (+ a small buffer) are rendered.
  const gridCols = gridExpanded ? 4 : 3;
  // Tall enough for the icon/thumb AND a name strip — every tile shows its
  // file name (truncated; full name in the hover tooltip), like big-box chips.
  const GRID_TILE_H = 60;
  const GRID_GAP = 6;
  const gridRowH = GRID_TILE_H + GRID_GAP;
  const gridTotalRows = Math.ceil(members.length / gridCols);
  const gridViewportH =
    (gridExpanded ? HUB_EXPANDED_SIZE.height : HUB_MINI_SIZE.height) - HUB_HEADER_H - 16;
  const gridFirstRow = Math.max(0, Math.floor(scrollTop / gridRowH) - 2);
  const gridLastRow = Math.min(
    gridTotalRows,
    Math.ceil((scrollTop + gridViewportH) / gridRowH) + 2
  );
  const gridWindow = members.slice(
    gridFirstRow * gridCols,
    Math.min(members.length, gridLastRow * gridCols)
  );
  const indexedAll = projectMedia.filter((m) => m.status === 'indexed').length;

  // Open "parking spaces" in the grid — dashed ghost tiles that say "drop
  // pieces here" without words. Empty tray shows a full first row; otherwise
  // the trailing open column of the current last row.
  const ghostSlots: number[] =
    everything || usesGrid
      ? []
      : memberCount === 0
      ? Array.from({ length: cols }, (_, i) => i)
      : memberCount % cols !== 0
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
        'group relative rounded-[18px] backdrop-blur-xl transition-all',
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
      {!everything && !usesGrid && (
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
            const slot = hubSlot(i, cols);
            return (
              <div
                key={i}
                style={{
                  left: slot.x - 6, // well is inset 6px from the body
                  top: slot.y - (HUB_HEADER_H - 2),
                  width: CHIP_W,
                  height: CHIP_H
                }}
                className={cn(
                  'absolute rounded-[11px] border border-dashed transition-colors duration-200',
                  // whisper at rest; brighten to the accent as a chip nears
                  d.glow
                    ? 'border-accent/50'
                    : 'border-black/[0.07] dark:border-white/[0.07]'
                )}
              />
            );
          })}
        </div>
      )}

      {/* MINIMIZED: a scrollable thumbnail grid in the box's own DOM (the real
          chips are hidden on the canvas). A 100-item box becomes a tidy 3-wide
          preview you can scroll, instead of eating the screen. */}
      {cluster && usesGrid && (
        <div
          onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
          style={{ top: HUB_HEADER_H - 2, bottom: 6 }}
          className="nodrag nowheel scroll-clean absolute inset-x-1.5 overflow-y-auto rounded-[13px] bg-[#eef1f5] p-1.5 dark:bg-black/30"
        >
          {/* spacer sized to ALL rows; only the windowed tiles are mounted, offset
              to the right scroll position — so a 3000-item box renders ~30 tiles. */}
          <div style={{ height: gridTotalRows * gridRowH, position: 'relative' }}>
            <div
              style={{ position: 'absolute', top: gridFirstRow * gridRowH, left: 0, right: 0 }}
              className={cn('grid gap-1.5', gridExpanded ? 'grid-cols-4' : 'grid-cols-3')}
            >
            {gridWindow.map(({ nodeId, nodeType, mediaId }) => {
              const m = mediaId ? mediaById.get(mediaId) : undefined;
              const isSource = nodeType === 'chip';
              // "Open" the original when it has a real URL (YouTube/website, or
              // an image source). Indexed-only types (doc/audio/text) have none.
              const url =
                m && typeof m.source === 'string' && /^https?:\/\//.test(m.source)
                  ? m.source
                  : undefined;
              return (
                <div
                  key={nodeId}
                  title={m?.name}
                  style={{ height: GRID_TILE_H }}
                  className="group/tile relative flex flex-col overflow-hidden rounded-md bg-black/[0.06] ring-1 ring-black/[0.05] dark:bg-white/[0.06]"
                >
                  {m?.thumbnail ? (
                    <img
                      src={m.thumbnail}
                      alt=""
                      loading="lazy"
                      className="min-h-0 w-full flex-1 object-cover"
                    />
                  ) : (
                    <span className="flex min-h-0 w-full flex-1 items-center justify-center">
                      <MediaIcon
                        type={(m?.type ?? 'document') as MediaType}
                        size="sm"
                      />
                    </span>
                  )}
                  {/* name strip — every tile shows its file name, same as the
                      full-size chips in small boxes (truncate; tooltip = full) */}
                  <span className="block w-full shrink-0 truncate px-1 pb-0.5 text-center text-[8.5px] font-semibold leading-[1.2] text-foreground/75">
                    {m?.name ?? ''}
                  </span>
                  {m?.status === 'failed' && (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-500 ring-1 ring-white" />
                  )}
                  {m && m.status !== 'indexed' && m.status !== 'failed' && (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 ring-1 ring-white" />
                  )}
                  {/* per-tile actions — open / pop out to canvas / delete. Only
                      on hover so the preview stays clean; nodrag so a click
                      never starts dragging the box. */}
                  <div className="nodrag absolute inset-0 flex items-center justify-center gap-1 bg-black/55 opacity-0 backdrop-blur-[1px] transition-opacity group-hover/tile:opacity-100">
                    {url && (
                      <button
                        title="Open the original"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(url, '_blank', 'noopener,noreferrer');
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-black shadow-sm transition-transform hover:scale-110"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      title="Pop out to the canvas"
                      onClick={(e) => {
                        e.stopPropagation();
                        undockMember(nodeId);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-black shadow-sm transition-transform hover:scale-110"
                    >
                      <ArrowUpRight className="h-3 w-3" />
                    </button>
                    <button
                      title={
                        isSource
                          ? 'Delete source (removes it + its vectors)'
                          : 'Remove from the board'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isSource && mediaId) {
                          if (
                            window.confirm(
                              `Delete "${m?.name ?? mediaId}" permanently? This removes it from your knowledge base and Pinecone. This cannot be undone.`
                            )
                          ) {
                            deleteMedia(mediaId);
                            removeBoardNode(nodeId);
                          }
                        } else {
                          removeBoardNode(nodeId);
                        }
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-red-600 shadow-sm transition-transform hover:scale-110"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}

      {/* top-right controls: MINIMIZE the box to the dock menu (saved, recallable)
          + remove it. Both appear on hover. */}
      <div className="nodrag absolute -right-2 -top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {cluster && (
          <button
            title="Minimize box to the dock menu — it stays saved; bring it back from the 📦 menu"
            onClick={(e) => {
              e.stopPropagation();
              stashBox(id);
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted-foreground/70 shadow-[0_1px_4px_rgb(0_0_0/0.14)] transition-colors hover:text-accent"
          >
            <Minus className="h-3 w-3" />
          </button>
        )}
        <button
          title={everything ? 'Hide the Everything hub' : 'Remove this box (pieces stay on the board)'}
          onClick={(e) => {
            e.stopPropagation();
            removeBoardNode(id);
          }}
          className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-muted-foreground/60 shadow-[0_1px_4px_rgb(0_0_0/0.14)] transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

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
        {cluster && memberCount > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleHubCollapse(id);
            }}
            title={collapsed ? 'Expand box' : 'Minimize box'}
            className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-black/[0.06] hover:text-foreground"
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        )}
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
