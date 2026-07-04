'use client';

import { useEffect, useRef, useState } from 'react';
import { HelpCircle, Send, Loader2, X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * DOC — the in-app expert on answersDoc itself (cinetana-style help bot).
 * Launcher lives in the top bar (never overlaps the Board's canvas chrome);
 * the panel is a right-side sheet. Knowledge = /api/help's sanitized manual.
 */

interface Msg {
  role: 'user' | 'bot';
  text: string;
}

const GREETING: Msg = {
  role: 'bot',
  text: "Hi — I'm Doc, the answersDoc expert. Ask me anything about the app: boards, boxes, DataBanks, the Boardroom, embeds, projects, uploads… I'll walk you through it."
};

const LS_KEY = 'answersdoc_helpbot_v1';

export function HelpBot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore the last conversation (nice across reloads; never precious data).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const a = JSON.parse(raw);
        if (Array.isArray(a) && a.length) setMsgs(a);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(msgs.slice(-30)));
    } catch {
      /* ignore */
    }
  }, [msgs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, open, busy]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput('');
    const next: Msg[] = [...msgs, { role: 'user', text: q }];
    setMsgs(next);
    setBusy(true);
    try {
      const r = await fetch('/api/help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.slice(-12).map((m) => ({ role: m.role, text: m.text }))
        }),
        signal: AbortSignal.timeout(60_000)
      });
      const j = await r.json().catch(() => null);
      setMsgs((prev) => [
        ...prev,
        {
          role: 'bot',
          text:
            (r.ok && j?.answer) ||
            j?.error ||
            'Hmm, I hit a snag — try that again in a moment.'
        }
      ]);
    } catch {
      setMsgs((prev) => [
        ...prev,
        { role: 'bot', text: 'Connection hiccup — please try again.' }
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Help — ask the answersDoc expert"
        title="Ask Doc — the built-in answersDoc expert"
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
          open
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground'
        )}
      >
        <HelpCircle className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div className="fixed right-3 top-14 z-50 flex h-[min(72vh,640px)] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-[20px] border border-[rgb(var(--hairline)/0.12)] bg-card shadow-[0_12px_48px_rgb(0_0_0/0.18)]">
          {/* header */}
          <div className="flex items-center gap-2.5 border-b border-[rgb(var(--hairline)/0.08)] bg-accent/[0.06] px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent text-accent-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[13.5px] font-semibold">Doc — product expert</p>
              <p className="text-[11px] text-muted-foreground">
                Knows every feature. Ask anything.
              </p>
            </div>
            <button
              onClick={() => setMsgs([GREETING])}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
              title="Start a fresh conversation"
            >
              Clear
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* messages */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
            <div className="flex flex-col gap-2.5">
              {msgs.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    'max-w-[86%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed',
                    m.role === 'user'
                      ? 'self-end rounded-br-md bg-accent text-accent-foreground'
                      : 'self-start rounded-bl-md bg-[rgb(var(--hairline)/0.06)]'
                  )}
                >
                  {m.text}
                </div>
              ))}
              {busy && (
                <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md bg-[rgb(var(--hairline)/0.06)] px-3.5 py-2 text-[13px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking…
                </div>
              )}
            </div>
          </div>

          {/* composer */}
          <div className="border-t border-[rgb(var(--hairline)/0.08)] p-2.5">
            <div className="flex items-end gap-1.5">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="e.g. How do I put my experts on my website?"
                className="max-h-28 min-h-[38px] flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-[13px] leading-relaxed outline-none focus:ring-1 focus:ring-accent/40"
              />
              <button
                onClick={send}
                disabled={!input.trim() || busy}
                className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-opacity disabled:opacity-40"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
