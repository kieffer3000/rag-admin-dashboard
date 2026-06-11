'use client';

import { memo, useRef, useState, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/lib/rag/board/store';
import { useRag } from '@/lib/rag/store';
import { generateMockAnswer, streamText } from '@/lib/rag/mock-answer';
import { ChatMessage } from '@/lib/rag/types';
import { MediaIcon } from '@/components/rag/shared';
import { Boxes, ArrowUp, Loader2, Unplug } from 'lucide-react';
import type { BrainData } from '@/lib/rag/board/types';

let msgCounter = 9000;
const nextMsgId = () => `bm${++msgCounter}`;

/**
 * The Brain — answersDoc's query node. Its knowledge basis is whatever is
 * WIRED to it: direct chips, typed hubs, the Everything hub. Text nodes add
 * ephemeral prompt context. This is the visual face of the Query webhook.
 */
function BrainNodeInner({ id, data, selected }: NodeProps) {
  const d = data as BrainData;
  const { brainMessages, addBrainMessage, updateBrainMessage, resolveBrainScope } =
    useBoard();
  const { openViewer } = useRag();
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = brainMessages[id] ?? [];
  const scope = resolveBrainScope(id);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function send() {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    addBrainMessage(id, {
      id: nextMsgId(),
      role: 'user',
      content: q,
      createdAt: new Date().toISOString()
    });

    setBusy(true);
    const asstId = nextMsgId();
    addBrainMessage(id, {
      id: asstId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString()
    });

    // P3 swaps this for the live Query webhook via /api/query.
    const ctxNote = scope.contextTexts.length
      ? `\n\n(Context from wired text nodes: ${scope.contextTexts.join(' · ')})`
      : '';
    const { content, citations } = generateMockAnswer(q, scope.items);
    streamText(
      content + ctxNote,
      (soFar) => updateBrainMessage(id, asstId, { content: soFar }),
      () => {
        updateBrainMessage(id, asstId, { citations });
        setBusy(false);
      }
    );
  }

  return (
    <div
      className={cn(
        'flex w-[400px] flex-col overflow-hidden rounded-[20px] bg-card',
        'shadow-[0_2px_6px_rgb(0_0_0/0.05),0_18px_50px_rgb(0_0_0/0.10)]',
        'dark:ring-1 dark:ring-white/[0.08]',
        selected && 'ring-2 ring-accent/60 dark:ring-accent/60'
      )}
    >
      {/* header */}
      <div className="flex items-center gap-2.5 bg-gradient-to-r from-indigo-500/[0.07] to-violet-500/[0.10] px-3.5 py-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_2px_10px_hsl(var(--accent)/0.45)]">
          <Boxes className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold tracking-tight">
            {d.name}
          </div>
          <div className="text-[10.5px] text-muted-foreground/70">
            {scope.everything
              ? 'Everything in project'
              : `${scope.items.length} source${scope.items.length === 1 ? '' : 's'} wired`}
            {scope.contextTexts.length > 0 && ` · ${scope.contextTexts.length} note`}
          </div>
        </div>
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            scope.items.length > 0 ? 'bg-emerald-500' : 'bg-amber-400'
          )}
        />
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        className="nodrag nowheel flex max-h-[300px] min-h-[120px] flex-col gap-2.5 overflow-y-auto px-3.5 py-3"
      >
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-4 text-center">
            {scope.items.length === 0 ? (
              <>
                <Unplug className="h-5 w-5 text-muted-foreground/40" />
                <p className="max-w-[260px] text-[11.5px] leading-relaxed text-muted-foreground/70">
                  Nothing wired yet — connect a chip, a hub, or the Everything
                  hub to give this brain its knowledge basis.
                </p>
              </>
            ) : (
              <p className="max-w-[260px] text-[11.5px] leading-relaxed text-muted-foreground/70">
                Ask anything — answers come only from the {scope.items.length}{' '}
                wired source{scope.items.length === 1 ? '' : 's'}, with
                citations.
              </p>
            )}
          </div>
        )}
        {messages.map((m) => (
          <BrainMessage key={m.id} m={m} onCitation={openViewer} />
        ))}
      </div>

      {/* composer */}
      <div className="px-3 pb-3">
        <div className="nodrag flex items-end gap-1.5 rounded-[14px] bg-[hsl(240_14%_96.5%)] px-2.5 py-1.5 dark:bg-white/[0.05]">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Ask your wired sources…"
            className="max-h-24 min-h-[30px] flex-1 resize-none bg-transparent py-1 text-[12.5px] outline-none placeholder:text-muted-foreground/50"
          />
          <button
            onClick={send}
            disabled={!question.trim() || busy}
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] transition-all',
              question.trim() && !busy
                ? 'bg-accent text-white shadow-[0_2px_8px_hsl(var(--accent)/0.4)]'
                : 'bg-black/[0.05] text-muted-foreground/40 dark:bg-white/[0.06]'
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-3.5 !w-3.5 !border-2 !border-card !bg-accent"
      />
    </div>
  );
}

function BrainMessage({
  m,
  onCitation
}: {
  m: ChatMessage;
  onCitation: (c: any) => void;
}) {
  if (m.role === 'user') {
    return (
      <div className="self-end rounded-[14px] rounded-br-[5px] bg-accent px-3 py-1.5 text-[12px] leading-relaxed text-white shadow-[0_2px_8px_hsl(var(--accent)/0.3)]">
        {m.content}
      </div>
    );
  }
  return (
    <div className="self-start">
      <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90">
        {m.content || <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/50" />}
      </div>
      {m.citations && m.citations.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {m.citations.map((c, i) => (
            <button
              key={i}
              onClick={() => onCitation(c)}
              className="flex items-center gap-1 rounded-md bg-accent/[0.07] px-1.5 py-0.5 text-[10px] font-medium text-accent transition-colors hover:bg-accent/[0.13]"
            >
              <MediaIcon type={c.type} size="sm" className="h-3.5 w-3.5 rounded" />
              <span className="max-w-[110px] truncate">{c.mediaName}</span>
              <span className="text-accent/60">{c.locator}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const BrainNode = memo(BrainNodeInner);
