'use client';

import { useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { MEDIA_TYPES } from '@/lib/rag/media-config';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  StickyNote,
  Trash2,
  Copy,
  Check,
  Download,
  Plus,
  Pin
} from 'lucide-react';

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function NotesView() {
  const { projectNotes, activeProject, addNote, deleteNote, openViewer } = useRag();
  const [draft, setDraft] = useState('');
  const [writing, setWriting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function exportAll() {
    const md =
      `# ${activeProject.name} — Notes\n\n` +
      projectNotes
        .map((n) => {
          let s = `## ${n.createdAt}\n\n${n.content}\n`;
          if (n.citations?.length) {
            s += '\nSources:\n';
            n.citations.forEach((c, i) => {
              s += `${i + 1}. ${c.mediaName} (${c.locator})\n`;
            });
          }
          return s;
        })
        .join('\n---\n\n');
    download(`${activeProject.name.toLowerCase().replace(/\s+/g, '-')}-notes.md`, md);
  }

  async function copyNote(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
    } catch {}
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="h-full p-2.5">
      <div className="panel flex h-full flex-col overflow-hidden rounded-[26px]">
        <div className="px-6 pt-6 lg:px-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">Notes</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {activeProject.icon} {activeProject.name} · {projectNotes.length} saved —
                pin any answer in chat, or write your own.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {projectNotes.length > 0 && (
                <Button variant="outline" className="gap-1.5 rounded-xl" onClick={exportAll}>
                  <Download className="h-4 w-4" /> Export all
                </Button>
              )}
              <Button
                variant="accent"
                className="gap-1.5 rounded-xl"
                onClick={() => setWriting(true)}
              >
                <Plus className="h-4 w-4" /> New note
              </Button>
            </div>
          </div>
        </div>

        <div className="scroll-clean flex-1 space-y-3 overflow-y-auto px-6 py-5 lg:px-8">
          {writing && (
            <div className="card-glass rounded-[18px] p-4">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a note…"
                className="min-h-[100px] border-none bg-transparent p-0 shadow-none focus-visible:ring-0"
                autoFocus
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setWriting(false);
                    setDraft('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="accent"
                  size="sm"
                  disabled={!draft.trim()}
                  onClick={() => {
                    addNote(draft.trim());
                    setDraft('');
                    setWriting(false);
                  }}
                >
                  Save note
                </Button>
              </div>
            </div>
          )}

          {projectNotes.length === 0 && !writing ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(240_16%_96.5%)] text-muted-foreground dark:bg-[rgb(255_255_255_/_0.05)]">
                <StickyNote className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium">No notes yet</p>
              <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
                Hover any answer in chat and tap the <Pin className="inline h-3 w-3" /> pin
                to save it here with its citations.
              </p>
            </div>
          ) : (
            projectNotes.map((n) => (
              <div key={n.id} className="card-glass hover-glow group rounded-[18px] p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/90">
                    {n.content}
                  </p>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => copyNote(n.id, n.content)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
                    >
                      {copiedId === n.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteNote(n.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-muted-foreground/70">{n.createdAt}</span>
                  {n.citations?.map((c, i) => {
                    const meta = MEDIA_TYPES[c.type];
                    return (
                      <button
                        key={i}
                        onClick={() => openViewer(c)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                          meta.tint,
                          meta.text
                        )}
                      >
                        {c.mediaName} · {c.locator}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
