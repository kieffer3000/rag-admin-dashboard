'use client';

import { memo } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/lib/rag/board/store';
import { Plus, X, GitFork } from 'lucide-react';

export interface MMNode {
  id: string;
  text: string;
  children: MMNode[];
}

let mmCounter = 0;
const mmId = () => `mm${Date.now().toString(36)}${++mmCounter}`;

const DEFAULT_TREE: MMNode = { id: 'root', text: 'Main Topic', children: [] };

function mapNode(t: MMNode, id: string, fn: (n: MMNode) => MMNode): MMNode {
  if (t.id === id) return fn(t);
  return { ...t, children: t.children.map((c) => mapNode(c, id, fn)) };
}
function addChildTo(t: MMNode, parentId: string, child: MMNode): MMNode {
  return mapNode(t, parentId, (n) => ({ ...n, children: [...n.children, child] }));
}
function removeNode(t: MMNode, id: string): MMNode {
  return { ...t, children: t.children.filter((c) => c.id !== id).map((c) => removeNode(c, id)) };
}

/** A self-contained editable mind map: central topic + branches. Enter adds a
 *  sibling, Tab adds a child — same gestures as the Poppy reference. */
function MindmapNodeInner({ id, data, selected }: NodeProps) {
  const d = data as { tree?: MMNode };
  const { updateBoardNodeData } = useBoard();
  const tree = d.tree ?? DEFAULT_TREE;
  const setTree = (t: MMNode) => updateBoardNodeData(id, { tree: t });

  function Branch({
    node,
    parentId,
    depth
  }: {
    node: MMNode;
    parentId: string | null;
    depth: number;
  }) {
    const isRoot = depth === 0;
    return (
      <div className={cn(!isRoot && 'border-l border-[rgb(var(--hairline)/0.14)] pl-3')}>
        <div className="group/mm flex items-center gap-1 py-0.5">
          <input
            value={node.text}
            placeholder="Topic…"
            onChange={(e) =>
              setTree(mapNode(tree, node.id, (n) => ({ ...n, text: e.target.value })))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parentId) {
                e.preventDefault();
                setTree(
                  addChildTo(tree, parentId, { id: mmId(), text: '', children: [] })
                );
              } else if (e.key === 'Tab') {
                e.preventDefault();
                setTree(
                  addChildTo(tree, node.id, { id: mmId(), text: '', children: [] })
                );
              }
            }}
            className={cn(
              'nodrag min-w-0 flex-1 rounded-[8px] bg-transparent px-2 py-1 text-[13px] outline-none transition-colors focus:bg-black/[0.03] dark:focus:bg-white/[0.05]',
              isRoot
                ? 'font-semibold text-accent'
                : 'font-medium text-foreground/90'
            )}
          />
          <button
            title="Add branch"
            onClick={() =>
              setTree(addChildTo(tree, node.id, { id: mmId(), text: '', children: [] }))
            }
            className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground/50 opacity-0 transition-all hover:bg-accent/10 hover:text-accent group-hover/mm:opacity-100"
          >
            <Plus className="h-3 w-3" />
          </button>
          {!isRoot && (
            <button
              title="Delete"
              onClick={() => setTree(removeNode(tree, node.id))}
              className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground/50 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover/mm:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {node.children.length > 0 && (
          <div className="ml-1">
            {node.children.map((c) => (
              <Branch key={c.id} node={c} parentId={node.id} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <NodeResizer
        minWidth={240}
        minHeight={140}
        isVisible={selected}
        lineClassName="!border-accent/40"
        handleClassName="!h-2.5 !w-2.5 !rounded-[3px] !border-accent !bg-card"
      />
      <div
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-[18px] bg-card',
          'shadow-[0_1px_3px_rgb(0_0_0/0.05),0_10px_30px_rgb(0_0_0/0.07)]',
          'dark:ring-1 dark:ring-white/[0.08]',
          selected && 'ring-2 ring-accent/60'
        )}
      >
        <div className="flex shrink-0 items-center gap-2 bg-[hsl(240_16%_97%)] px-3 py-2 dark:bg-white/[0.04]">
          <GitFork className="h-3.5 w-3.5 text-accent" />
          <span className="text-[12px] font-semibold tracking-tight">Mind map</span>
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            Enter = branch · Tab = child
          </span>
        </div>
        <div className="nodrag nowheel min-h-0 flex-1 overflow-auto p-2.5">
          <Branch node={tree} parentId={null} depth={0} />
        </div>
      </div>
    </div>
  );
}

export const MindmapNode = memo(MindmapNodeInner);
