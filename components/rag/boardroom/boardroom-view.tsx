'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Landmark,
  Send,
  FileText,
  X,
  Download,
  Loader2,
  BookOpen,
  RefreshCw,
  ScrollText
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { useBoard } from '@/lib/rag/board/store';
import { askBrain, opineBrain } from '@/lib/rag/board/ask';
import type { Citation } from '@/lib/rag/types';

// 🏛 THE BOARDROOM — Boardroom build order items 2+3 (BOARDROOM_BRIEF.md).
// Napoleon Hill's "Invisible Counselors" made real: the user's expert Banks
// sit around a table; one question fans out to every seated expert IN
// PARALLEL; each answers in its own voice, from its own sources, with its
// stored doctrine injected server-side (item 1). Table a document and the
// room critiques it, each expert on its own lane. Disagreement is the
// product — answers are never averaged.
//
// No API keys anywhere: the room calls its own Banks natively through the
// same in-app paths the board chat uses (askBrain/opineBrain → /api/query +
// /api/opine, doctrine injection riding on bank_node_id).

interface SeatResponse {
  bankId: string;
  name: string;
  status: 'thinking' | 'done' | 'error';
  answer?: string;
  citations?: Citation[];
  noMatch?: boolean;
  error?: string;
  ms?: number;
}

interface RoomEntry {
  id: string;
  ts: number;
  question: string;
  /** Title of the tabled document, when the question ran as a critique. */
  tabled?: string;
  responses: SeatResponse[];
}

interface RoomDoc {
  seatedIds: string[];
  transcript: RoomEntry[];
  tabled: { title: string; content: string } | null;
  depth: 'fast' | 'detailed';
}

const LS_PREFIX = 'ad_boardroom_v1_';
const TRANSCRIPT_CAP = 60;

/** Concise-by-default (the brief's latency-feel rule): meetings want speech,
 *  not essays. The user can always ask an expert to go deeper. */
const ROOM_GUIDE =
  'You are speaking in a boardroom meeting. Answer in the first person, in your own voice, and keep it under 150 words unless the question explicitly asks for depth. Take a position — if you disagree with common advice, say so plainly.';

function loadRoom(pid: string): RoomDoc | null {
  try {
    const s = localStorage.getItem(LS_PREFIX + pid);
    return s ? (JSON.parse(s) as RoomDoc) : null;
  } catch {
    return null;
  }
}
function saveRoom(pid: string, doc: RoomDoc) {
  try {
    localStorage.setItem(
      LS_PREFIX + pid,
      JSON.stringify({ ...doc, transcript: doc.transcript.slice(-TRANSCRIPT_CAP) })
    );
  } catch {
    /* quota — the meeting continues in memory */
  }
}

/** Seat avatar — the Bank's initials in a portrait ring. */
function SeatAvatar({ name, active }: { name: string; active: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-bold ring-2 transition-colors',
        active
          ? 'bg-accent/15 text-accent ring-accent/40'
          : 'bg-black/[0.05] text-muted-foreground/50 ring-black/[0.08] dark:bg-white/[0.06] dark:ring-white/[0.1]'
      )}
    >
      {initials || <Landmark className="h-5 w-5" />}
    </span>
  );
}

export function BoardroomView() {
  const { activeProjectId } = useRag();
  const { board, resolveBrainScope, hydratedProject } = useBoard();
  const hydrated = hydratedProject === activeProjectId;

  // Every Bank in this project — on the canvas AND parked in the Chest — is
  // eligible for a seat. Wired sources make it consultable.
  const banks = useMemo(() => {
    const canvas = board.nodes
      .filter((n) => n.type === 'brain')
      .map((n) => ({ id: n.id, name: (n.data.name as string) || 'Answers Bank' }));
    const stashed = (board.stashedBrains ?? []).map((s) => ({
      id: s.node.id,
      name: (s.node.data.name as string) || 'Answers Bank'
    }));
    const seen = new Set<string>();
    return [...canvas, ...stashed].filter((b) =>
      seen.has(b.id) ? false : (seen.add(b.id), true)
    );
  }, [board.nodes, board.stashedBrains]);

  const [seatedIds, setSeatedIds] = useState<Set<string>>(new Set());
  const [transcript, setTranscript] = useState<RoomEntry[]>([]);
  const [tabled, setTabled] = useState<{ title: string; content: string } | null>(null);
  const [depth, setDepth] = useState<'fast' | 'detailed'>('fast');
  const [tableOpen, setTableOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [openSources, setOpenSources] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [doctrines, setDoctrines] = useState<Map<string, number>>(new Map());
  const restored = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // ---- Restore the room per project (seats, transcript, tabled doc). ----
  useEffect(() => {
    if (restored.current === activeProjectId) return;
    restored.current = activeProjectId;
    const doc = loadRoom(activeProjectId);
    if (doc) {
      setSeatedIds(new Set(doc.seatedIds));
      setTranscript(doc.transcript ?? []);
      setTabled(doc.tabled ?? null);
      setDepth(doc.depth === 'detailed' ? 'detailed' : 'fast');
    } else {
      setSeatedIds(new Set()); // default = everyone with sources (applied below)
      setTranscript([]);
      setTabled(null);
    }
  }, [activeProjectId]);

  // Default seating: once the board hydrates, seat every Bank that has wired
  // sources — unless the user already arranged this room's chairs.
  useEffect(() => {
    if (!hydrated || loadRoom(activeProjectId)) return;
    const wired = banks.filter((b) => resolveBrainScope(b.id).items.length > 0);
    if (wired.length) setSeatedIds(new Set(wired.map((b) => b.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, activeProjectId, banks.length]);

  // Persist the room whenever it changes (small doc, capped transcript).
  useEffect(() => {
    if (restored.current !== activeProjectId) return;
    saveRoom(activeProjectId, {
      seatedIds: [...seatedIds],
      transcript,
      tabled,
      depth
    });
  }, [seatedIds, transcript, tabled, depth, activeProjectId]);

  // Doctrine badges — which seats have their judgment loaded (vN chip).
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        banks.map(async (b) => {
          try {
            const r = await fetch(
              `/api/doctrine?projectId=${encodeURIComponent(activeProjectId)}&bankId=${encodeURIComponent(b.id)}`
            );
            const d = r.ok ? await r.json() : null;
            return [b.id, d?.doctrine ? Number(d.version) : 0] as const;
          } catch {
            return [b.id, 0] as const;
          }
        })
      );
      if (!cancelled) setDoctrines(new Map(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, banks, activeProjectId]);

  // Meeting clock while any expert is thinking.
  useEffect(() => {
    if (!asking) return;
    setClock(0);
    const iv = setInterval(() => setClock((c) => c + 1), 1000);
    return () => clearInterval(iv);
  }, [asking]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript]);

  const toggleSeat = (id: string) =>
    setSeatedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  /** One seat answers one question (used by the fan-out AND per-seat retry). */
  const consultSeat = useCallback(
    async (entryId: string, bankId: string, q: string) => {
      const scope = resolveBrainScope(bankId);
      const started = Date.now();
      const patch = (p: Partial<SeatResponse>) =>
        setTranscript((prev) =>
          prev.map((en) =>
            en.id !== entryId
              ? en
              : {
                  ...en,
                  responses: en.responses.map((r) =>
                    r.bankId === bankId ? { ...r, ...p } : r
                  )
                }
          )
        );
      patch({ status: 'thinking', error: undefined });
      // This seat's own prior turns in the meeting → follow-ups resolve.
      const history = transcript
        .flatMap((en) => {
          const own = en.responses.find(
            (r) => r.bankId === bankId && r.status === 'done' && r.answer
          );
          return own
            ? [
                { role: 'user' as const, content: en.question },
                {
                  role: 'assistant' as const,
                  content: own.answer!.replace(/<[^>]+>/g, ' ').slice(0, 1500)
                }
              ]
            : [];
        })
        .slice(-12);
      try {
        const r = tabled
          ? await opineBrain(
              q,
              scope.items,
              { title: tabled.title, content: tabled.content },
              scope.references,
              [...scope.guides, ROOM_GUIDE],
              'on',
              'cited',
              history,
              activeProjectId,
              bankId
            )
          : await askBrain(
              q,
              scope.items,
              scope.contextTexts,
              undefined,
              'cited',
              [...scope.guides, ROOM_GUIDE],
              history,
              '',
              depth,
              scope.clusterIds,
              scope.everything,
              activeProjectId,
              bankId
            );
        patch({
          status: 'done',
          answer: r.answer,
          citations: r.citations,
          noMatch: r.noMatch,
          ms: Date.now() - started
        });
      } catch (e) {
        patch({
          status: 'error',
          error: e instanceof Error ? e.message : 'The expert could not answer.',
          ms: Date.now() - started
        });
      }
    },
    [resolveBrainScope, transcript, tabled, depth, activeProjectId]
  );

  /** Ask the room — fan the question out to every seated expert in parallel. */
  const askRoom = useCallback(async () => {
    const q = question.trim();
    const seats = banks.filter((b) => seatedIds.has(b.id));
    if (!q || !seats.length || asking) return;
    setQuestion('');
    setAsking(true);
    const entryId = `room${Date.now()}`;
    setTranscript((prev) => [
      ...prev,
      {
        id: entryId,
        ts: Date.now(),
        question: q,
        tabled: tabled?.title,
        responses: seats.map((s) => ({
          bankId: s.id,
          name: s.name,
          status: 'thinking' as const
        }))
      }
    ]);
    await Promise.all(seats.map((s) => consultSeat(entryId, s.id, q)));
    setAsking(false);
  }, [question, banks, seatedIds, asking, tabled, consultSeat]);

  /** Export the minutes as Markdown. */
  const exportMinutes = () => {
    const lines: string[] = [`# Boardroom minutes — ${new Date().toLocaleString()}`, ''];
    for (const en of transcript) {
      lines.push(`## ${en.question}`);
      if (en.tabled) lines.push(`*On the table: ${en.tabled}*`);
      for (const r of en.responses) {
        lines.push('', `**${r.name}:**`);
        lines.push(
          r.status === 'done'
            ? (r.answer ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            : `_(${r.status === 'error' ? `no answer — ${r.error}` : 'no answer'})_`
        );
      }
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'boardroom-minutes.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const seats = banks.filter((b) => seatedIds.has(b.id));
  const mm = String(Math.floor(clock / 60));
  const ss = String(clock % 60).padStart(2, '0');

  return (
    <div className="flex h-full flex-col">
      {/* ---- Header ---- */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Landmark className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[17px] font-bold leading-tight">The Boardroom</h1>
          <p className="truncate text-[12px] text-muted-foreground">
            Your invisible counselors — one question, every expert answers. Disagreement is the
            point.
          </p>
        </div>
        {/* Depth: fast = meeting tempo; detailed = full pipeline */}
        <div className="flex overflow-hidden rounded-lg ring-1 ring-border">
          {(['fast', 'detailed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setDepth(s)}
              className={cn(
                'px-2.5 py-1 text-[11.5px] font-semibold capitalize transition-colors',
                depth === s ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-accent/10'
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={exportMinutes}
          disabled={!transcript.length}
          title="Export the minutes (.md)"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-40"
        >
          <Download className="h-4 w-4" />
        </button>
      </div>

      {/* ---- Seats ---- */}
      <div className="flex gap-2.5 overflow-x-auto border-b border-border px-5 py-3">
        {!hydrated ? (
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Setting the chairs…
          </span>
        ) : banks.length === 0 ? (
          <span className="text-[13px] text-muted-foreground">
            No experts yet — build Banks on the{' '}
            <Link href="/board" className="font-semibold text-accent underline">
              Board
            </Link>{' '}
            first (wire a Library, add a doctrine), then walk back in.
          </span>
        ) : (
          banks.map((b) => {
            const seated = seatedIds.has(b.id);
            const n = resolveBrainScope(b.id).items.length;
            const dv = doctrines.get(b.id) ?? 0;
            return (
              <button
                key={b.id}
                onClick={() => toggleSeat(b.id)}
                title={
                  seated
                    ? `${b.name} is at the table — click to excuse`
                    : `Seat ${b.name} at the table`
                }
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-2xl px-3 py-2 ring-1 transition-all',
                  seated
                    ? 'bg-card ring-accent/30 shadow-[0_2px_10px_-2px_rgb(0_0_0/0.08)]'
                    : 'opacity-55 ring-border hover:opacity-80'
                )}
              >
                <SeatAvatar name={b.name} active={seated} />
                <span className="text-left">
                  <span className="block max-w-[130px] truncate text-[12.5px] font-bold leading-tight">
                    {b.name}
                  </span>
                  <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    {n} sources
                    {dv > 0 && (
                      <span
                        title={`Doctrine v${dv} loaded`}
                        className="flex items-center gap-0.5 rounded-full bg-accent/10 px-1 text-accent"
                      >
                        <ScrollText className="h-2.5 w-2.5" />v{dv}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* ---- On the table ---- */}
      <div className="border-b border-border px-5 py-2">
        {tabled ? (
          <div className="flex items-center gap-2 text-[12.5px]">
            <FileText className="h-4 w-4 shrink-0 text-accent" />
            <span className="min-w-0 truncate">
              On the table: <b>{tabled.title}</b> — the room critiques it; ask away.
            </span>
            <button
              onClick={() => setTabled(null)}
              title="Take the document off the table"
              className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-red-50 hover:text-red-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : tableOpen ? (
          <TableForm
            onCancel={() => setTableOpen(false)}
            onSet={(t) => {
              setTabled(t);
              setTableOpen(false);
            }}
          />
        ) : (
          <button
            onClick={() => setTableOpen(true)}
            className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-accent"
          >
            <FileText className="h-3.5 w-3.5" /> Table a document — the room will critique it
          </button>
        )}
      </div>

      {/* ---- Transcript ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {transcript.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-[28%] bg-accent/5 text-accent/40 ring-1 ring-accent/10">
              <Landmark className="h-8 w-8" />
            </span>
            <p className="max-w-[420px] text-[13.5px] leading-relaxed text-muted-foreground">
              {seats.length
                ? `${seats.length} expert${seats.length > 1 ? 's are' : ' is'} seated. Ask the room anything — each answers in their own voice, from their own sources. Nightly cabinet meetings, as Napoleon Hill kept them.`
                : 'Seat your experts above, then ask the room.'}
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-6">
            {transcript.map((en) => (
              <div key={en.id}>
                <div className="mb-3 flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13.5px] leading-relaxed text-white">
                    {en.question}
                    {en.tabled && (
                      <span className="mt-1 block text-[11px] opacity-80">
                        re: {en.tabled}
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  {en.responses.map((r) => (
                    <div key={r.bankId} className="flex gap-2.5">
                      <SeatAvatar name={r.name} active />
                      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-card px-3.5 py-2.5 ring-1 ring-border">
                        <p className="mb-1 flex items-center gap-2 text-[12px] font-bold text-accent">
                          {r.name}
                          {r.status === 'done' && r.ms != null && (
                            <span className="font-normal text-muted-foreground/60">
                              {(r.ms / 1000).toFixed(0)}s
                            </span>
                          )}
                        </p>
                        {r.status === 'thinking' ? (
                          <p className="flex items-center gap-2 text-[13px] italic text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {r.name} is thinking… {mm}:{ss}
                          </p>
                        ) : r.status === 'error' ? (
                          <p className="flex items-start gap-2 text-[13px] text-red-600">
                            <span className="min-w-0">{r.error}</span>
                            <button
                              onClick={() => consultSeat(en.id, r.bankId, en.question)}
                              title="Ask this expert again"
                              className="ml-auto flex shrink-0 items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold hover:bg-red-100"
                            >
                              <RefreshCw className="h-3 w-3" /> Retry
                            </button>
                          </p>
                        ) : (
                          <>
                            <div
                              className="prose prose-sm max-w-none text-[13.5px] leading-relaxed [&_mark]:bg-accent/20 [&_sup]:text-accent"
                              dangerouslySetInnerHTML={{ __html: r.answer ?? '' }}
                            />
                            {r.noMatch && (
                              <p className="mt-1 text-[11.5px] italic text-amber-600">
                                Weak grounding — this may reach past the sources.
                              </p>
                            )}
                            {(r.citations?.length ?? 0) > 0 && (
                              <div className="mt-1.5">
                                <button
                                  onClick={() =>
                                    setOpenSources((s) =>
                                      s === `${en.id}:${r.bankId}` ? null : `${en.id}:${r.bankId}`
                                    )
                                  }
                                  className="flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-accent"
                                >
                                  <BookOpen className="h-3 w-3" /> source?
                                </button>
                                {openSources === `${en.id}:${r.bankId}` && (
                                  <ul className="mt-1.5 space-y-1.5 rounded-lg bg-black/[0.03] p-2 text-[12px] dark:bg-white/[0.04]">
                                    {r.citations!.slice(0, 6).map((c, i) => (
                                      <li key={i} className="leading-snug">
                                        <b>{c.mediaName}</b>
                                        {c.locator ? ` · ${c.locator}` : ''} —{' '}
                                        <span className="text-muted-foreground">
                                          {(c.snippet ?? '').slice(0, 180)}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* ---- Ask the room ---- */}
      <div className="border-t border-border px-5 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                askRoom();
              }
            }}
            rows={2}
            placeholder={
              seats.length
                ? tabled
                  ? `Ask the room about "${tabled.title}"…`
                  : 'Ask the room…'
                : 'Seat at least one expert first'
            }
            disabled={!seats.length}
            className="min-h-[46px] flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-[13.5px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
          />
          <button
            onClick={askRoom}
            disabled={!question.trim() || !seats.length || asking}
            title="Ask every seated expert"
            className="flex h-[46px] items-center gap-2 rounded-xl bg-accent px-4 text-[13.5px] font-semibold text-white shadow-sm transition-transform hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100"
          >
            {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Ask the room
          </button>
        </div>
      </div>
    </div>
  );
}

/** Inline form for tabling a document (paste text — the meeting's artifact). */
function TableForm({
  onSet,
  onCancel
}: {
  onSet: (t: { title: string; content: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  return (
    <div className="space-y-1.5 py-1">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title — e.g. 'Launch plan draft'"
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        placeholder="Paste the document to put on the table…"
        className="w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12.5px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/40"
      />
      <div className="flex gap-2">
        <button
          onClick={() =>
            content.trim() &&
            onSet({ title: title.trim() || 'Untitled document', content: content.trim() })
          }
          disabled={!content.trim()}
          className="rounded-lg bg-accent px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Put on the table
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg px-3 py-1 text-[12px] font-medium text-muted-foreground hover:bg-black/[0.05]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
