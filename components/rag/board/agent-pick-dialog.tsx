'use client';

import { useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { Agent } from '@/lib/rag/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Search } from 'lucide-react';

/**
 * PERSONA PICKER (board pill) — clicking a bank's Persona pill opens this to
 * choose ONE saved agent; on pick, board-canvas drops an agent node and wires
 * it to the bank's robot plug. (A bank takes exactly one persona.)
 *
 * Personas are AUTHORED on the Agents page; this only PICKS one — keeping a
 * single source of truth for the prompt.
 */
export function AgentPickDialog({
  open,
  onOpenChange,
  onPick
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (a: Agent) => void;
}) {
  const { agents } = useRag();
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const shown = ql
    ? agents.filter((a) =>
        `${a.name} ${a.systemPrompt}`.toLowerCase().includes(ql)
      )
    : agents;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setQ('');
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Wire a Persona</DialogTitle>
          <DialogDescription>
            Pick one saved agent — its voice steers how this bank answers. Create
            or edit agents on the Agents page.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search agents…"
            className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>

        <div className="scroll-clean max-h-[46vh] min-h-[160px] overflow-y-auto rounded-xl border border-[rgb(var(--hairline)/0.08)]">
          {shown.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
              {agents.length === 0
                ? 'No agents yet — create one on the Agents page first.'
                : 'No agents match your search.'}
            </p>
          ) : (
            shown.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  onPick(a);
                  onOpenChange(false);
                  setQ('');
                }}
                className="flex w-full items-start gap-2.5 border-b border-[rgb(var(--hairline)/0.06)] px-3 py-2.5 text-left last:border-b-0 hover:bg-accent/[0.06]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary text-base">
                  {a.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    a.icon ?? '🤖'
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">
                    {a.name}
                  </span>
                  <span className="line-clamp-2 block text-[11.5px] text-muted-foreground">
                    {a.systemPrompt}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
