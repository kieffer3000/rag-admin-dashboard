'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HelpDot } from '@/components/rag/help-dot';
import { ScrollText, Sparkles, History, Loader2 } from 'lucide-react';

const HELP_EXPERTISE = `Optional — a standing instruction this expert keeps in its pocket, quietly attached to EVERY answer it gives (chat, research, the Boardroom, connected apps).

It shapes HOW the expert judges — e.g. "judge hooks ONLY by these 5 rules; the old 12-point list is superseded."

It never changes the knowledge base: the books and their vectors stay exactly as they are.`;

const HELP_REFINE = `Fact-checks THIS text against the expert's own sources: "read your books — is this note right?"

The sources reply with numbered corrections (rules that are missing, overstated, or out of order). Apply what convinces you, then Save.

Read-only on the knowledge base — it never adds, deletes, or changes any vectors. You'll rarely need it: once after first writing this, and again after adding a pile of new sources.`;

const HELP_VERSION = `Every Save bumps the version (v1 → v2 …) and your change note becomes a changelog entry — so you can see how this expert's rules evolved.`;

// DOCTRINE editor — Boardroom build order item 1 (BOARDROOM_BRIEF.md).
// A doctrine is the Bank's judgment distilled into a one-page rubric,
// stored ON the Bank and injected as guides[] on every call (in-app chat,
// research mode, and the public /v1 endpoints). "Refine against sources"
// runs the self-correction loop: the doctrine is sent to the Bank's OWN
// corpus for critique — the books correct the rules, the version bumps.

interface DoctrineRec {
  doctrine: string;
  version: number;
  updated_at: string | null;
  log: Array<{ v: number; at: string; note: string }>;
}

const REFINE_INSTRUCTION = `You are reviewing your own doctrine — the rubric that steers how you judge and answer. Critique it STRICTLY against your source material, not against general knowledge. Return NUMBERED CORRECTIONS ONLY — do not rewrite the whole doctrine. Cover: (1) anything the rubric gets wrong or overstates according to the sources; (2) missing principles the sources insist on; (3) ordering or emphasis corrections; (4) for each correction, the exact suggested edit, quoted. If the rubric is faithful to the sources on a point, do not pad — only report genuine corrections.`;

export function DoctrineDialog({
  open,
  onOpenChange,
  bankLabel,
  bankId,
  projectId,
  sourceIds
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  bankLabel: string;
  bankId: string;
  projectId: string;
  /** The Bank's wired sources — the corpus the refine loop critiques against. */
  sourceIds: string[];
}) {
  const [rec, setRec] = useState<DoctrineRec | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  const [critique, setCritique] = useState('');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load the stored doctrine when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    setCritique('');
    (async () => {
      try {
        const r = await fetch(
          `/api/doctrine?projectId=${encodeURIComponent(projectId)}&bankId=${encodeURIComponent(bankId)}`
        );
        if (!r.ok) throw new Error(`load failed (${r.status})`);
        const data = (await r.json()) as DoctrineRec;
        if (!cancelled) {
          setRec(data);
          setDraft(data.doctrine);
        }
      } catch {
        if (!cancelled) setError('Could not load the saved expertise — try reopening.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, bankId]);

  useEffect(() => {
    if (refining) {
      setElapsed(0);
      timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refining]);

  const dirty = rec !== null && draft !== rec.doctrine;

  const save = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/doctrine', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, bankId, doctrine: draft, note })
      });
      if (!r.ok) throw new Error(`save failed (${r.status})`);
      const data = (await r.json()) as DoctrineRec;
      setRec(data);
      setNote('');
    } catch {
      setError('Save failed — your text is still here; try again.');
    } finally {
      setSaving(false);
    }
  }, [projectId, bankId, draft, note]);

  // The self-correction loop: send the DRAFT to the Bank's own corpus for
  // critique. Deliberately NO bank_node_id — the rubric must not steer the
  // critique of itself. Citations ON so corrections come sourced.
  const refine = useCallback(async () => {
    if (!draft.trim()) {
      setError('Write a draft first — the sources need something to correct.');
      return;
    }
    if (sourceIds.length === 0) {
      setError('This Bank has no wired sources to refine against — wire its Library first.');
      return;
    }
    setRefining(true);
    setError('');
    setCritique('');
    try {
      const r = await fetch('/api/opine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: REFINE_INSTRUCTION,
          artifact: { title: `${bankLabel} — doctrine draft`, content: draft },
          source_ids: sourceIds,
          citations: 'on',
          grounding: 'cited',
          project_id: projectId
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `refine failed (${r.status})`);
      const answer =
        typeof data.answer === 'string'
          ? data.answer
          : typeof data === 'string'
            ? data
            : '';
      setCritique(answer || 'The sources returned no corrections.');
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? `Refine failed: ${e.message}`
          : 'Refine failed — the corpus critique did not complete. Try again.'
      );
    } finally {
      setRefining(false);
    }
  }, [draft, sourceIds, bankLabel, projectId]);

  const mm = String(Math.floor(elapsed / 60)).padStart(1, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <Dialog open={open} onOpenChange={(o) => !refining && onOpenChange(o)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-accent" />
            Expertise — {bankLabel}
            <HelpDot text={HELP_EXPERTISE} />
            {rec && rec.version > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
                v{rec.version}
                <HelpDot text={HELP_VERSION} />
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            What this expert believes and how it judges — optional. It quietly rides every answer
            this Bank gives (chat, research, the Boardroom, and connected apps). Refine it against
            the sources and the books correct the rules.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`ROLE: You are ${bankLabel}…\nPRIME DIRECTIVE: …\nPrinciples to judge against:\n1. …`}
            className="h-56 w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/40"
            disabled={refining}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Change note (optional) — e.g. 'applied source corrections'"
              className="h-9 flex-1 text-[13px]"
              disabled={refining}
            />
            <Button size="sm" onClick={save} disabled={saving || refining || !dirty}>
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {dirty ? `Save as v${(rec?.version ?? 0) + 1}` : 'Saved'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={refine}
              disabled={refining || saving}
              className="gap-1.5"
            >
              {refining ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-accent" />
              )}
              Refine against sources
            </Button>
            <HelpDot text={HELP_REFINE} />
          </div>

          {refining && (
            <p className="text-[12.5px] text-muted-foreground">
              Consulting the sources… a real critique can take several minutes. {mm}:{ss}
            </p>
          )}
          {error && <p className="text-[12.5px] font-medium text-red-600">{error}</p>}

          {critique && (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-accent/25 bg-accent/5 p-3">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
                The sources say
              </p>
              <div
                className="prose prose-sm max-w-none text-[13px] leading-relaxed [&_mark]:bg-accent/20"
                dangerouslySetInnerHTML={{ __html: critique }}
              />
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                Apply what convinces you above, then Save — the version bumps and the change note
                becomes the changelog entry.
              </p>
            </div>
          )}

          {rec && rec.log.length > 0 && (
            <div>
              <button
                onClick={() => setShowLog((s) => !s)}
                className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                <History className="h-3.5 w-3.5" />
                {showLog ? 'Hide' : 'Show'} changelog ({rec.log.length})
              </button>
              {showLog && (
                <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto text-[12px] text-muted-foreground">
                  {rec.log.map((l) => (
                    <li key={l.v}>
                      <span className="font-bold text-foreground/70">v{l.v}</span> ·{' '}
                      {l.at.slice(0, 10)} — {l.note}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
