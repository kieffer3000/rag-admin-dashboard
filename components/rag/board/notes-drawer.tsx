'use client';

import { useMemo, useState } from 'react';
import { useRag } from '@/lib/rag/store';
import { HelpDot } from '@/components/rag/help-dot';
import { StickyNote, Pin, Trash2, X, Crosshair } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * NOTES DRAWER (Make-style, 2026-07-04) — replaces the Notes TAB. Slides over
 * the Board so notes live where the work is. Two kinds, like Make:
 *  - MODULE notes: attached to a specific node (right-click a piece/bank/box →
 *    "Add note"); the label chip focuses that node.
 *  - GENERAL notes: project-wide, presented as sticky notes.
 * Any note can be PINNED onto the canvas as a real sticky (annotation node).
 * Same notes store as before — nothing moved, nothing lost.
 */

const HELP_NOTES =
  "Project notes, Make-style. Right-click any piece, box or DataBank and choose 'Add note' to attach a note to it — or write a general note here. 📌 pins a note onto the canvas as a sticky. Deleting a note never touches the thing it was about.";

export function NotesDrawer({
  open,
  onClose,
  draftFor,
  onClearDraftFor,
  onPinToBoard,
  onFocusNode
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-attached target when opened via right-click → "Add note". */
  draftFor: { nodeId: string; nodeName: string } | null;
  onClearDraftFor: () => void;
  /** Drop the note's text onto the canvas as an annotation sticky. */
  onPinToBoard: (text: string) => void;
  /** Center the canvas on a node (module-note chip click). */
  onFocusNode: (nodeId: string) => void;
}) {
  const { notes, addNote, deleteNote, activeProjectId } = useRag();
  const [text, setText] = useState('');

  const projectNotes = useMemo(
    () => notes.filter((n) => n.projectId === activeProjectId),
    [notes, activeProjectId]
  );
  const moduleNotes = projectNotes.filter((n) => n.nodeId);
  const generalNotes = projectNotes.filter((n) => !n.nodeId);

  if (!open) return null;

  function submit() {
    const t = text.trim();
    if (!t) return;
    addNote(t, undefined, draftFor ?? undefined);
    setText('');
    onClearDraftFor();
  }

  return (
    <div className="nodrag absolute bottom-3 right-3 top-3 z-[45] flex w-[340px] flex-col overflow-hidden rounded-[20px] border border-[rgb(var(--hairline)/0.14)] bg-card/95 shadow-[0_12px_48px_rgb(0_0_0/0.2)] backdrop-blur">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-[rgb(var(--hairline)/0.08)] px-4 py-3">
        <StickyNote className="h-4 w-4 text-amber-500" />
        <span className="text-[13.5px] font-semibold">Notes</span>
        <HelpDot text={HELP_NOTES} side="left" />
        <span className="ml-1 text-[11px] text-muted-foreground">
          {projectNotes.length}
        </span>
        <button
          onClick={onClose}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* composer */}
      <div className="border-b border-[rgb(var(--hairline)/0.08)] p-3">
        {draftFor && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px]">
            <span className="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent">
              on: {draftFor.nodeName}
            </span>
            <button
              onClick={onClearDraftFor}
              className="text-muted-foreground hover:text-foreground"
              title="Make it a general note instead"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={
            draftFor ? `Note about ${draftFor.nodeName}…` : 'Write a note…'
          }
          className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-[13px] leading-relaxed outline-none focus:ring-1 focus:ring-accent/40"
        />
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="mt-1.5 w-full rounded-xl bg-amber-400/90 py-1.5 text-[12.5px] font-semibold text-amber-950 transition-opacity hover:bg-amber-400 disabled:opacity-40"
        >
          Add note
        </button>
      </div>

      {/* notes */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {projectNotes.length === 0 && (
          <p className="px-2 py-6 text-center text-[12.5px] text-muted-foreground">
            No notes yet. Write one above, or right-click any piece on the
            board and choose “Add note”.
          </p>
        )}

        {moduleNotes.length > 0 && (
          <>
            <p className="px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/60">
              On pieces
            </p>
            <div className="mb-3 space-y-2">
              {moduleNotes.map((n) => (
                <StickyCard
                  key={n.id}
                  text={n.content}
                  date={n.createdAt}
                  chip={n.nodeName || 'piece'}
                  onChip={() => n.nodeId && onFocusNode(n.nodeId)}
                  onPin={() => onPinToBoard(n.content)}
                  onDelete={() => deleteNote(n.id)}
                />
              ))}
            </div>
          </>
        )}

        {generalNotes.length > 0 && (
          <>
            <p className="px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/60">
              General
            </p>
            <div className="space-y-2">
              {generalNotes.map((n, i) => (
                <StickyCard
                  key={n.id}
                  text={n.content}
                  date={n.createdAt}
                  tilt={i % 2 === 0 ? -0.4 : 0.5}
                  onPin={() => onPinToBoard(n.content)}
                  onDelete={() => deleteNote(n.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StickyCard({
  text,
  date,
  chip,
  tilt = 0,
  onChip,
  onPin,
  onDelete
}: {
  text: string;
  date: string;
  chip?: string;
  tilt?: number;
  onChip?: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={tilt ? { transform: `rotate(${tilt}deg)` } : undefined}
      className="group rounded-[12px] border border-amber-300/50 bg-amber-100/90 p-2.5 shadow-[0_2px_8px_rgb(0_0_0/0.08)] dark:border-amber-400/25 dark:bg-amber-400/[0.12]"
    >
      {chip && (
        <button
          onClick={onChip}
          title="Show this piece on the board"
          className="mb-1 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[10.5px] font-semibold text-amber-900 hover:bg-white dark:bg-black/25 dark:text-amber-200"
        >
          <Crosshair className="h-2.5 w-2.5" /> {chip}
        </button>
      )}
      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-amber-950 dark:text-amber-100/90">
        {text}
      </p>
      <div className="mt-1.5 flex items-center gap-1">
        <span className="text-[10px] text-amber-800/60 dark:text-amber-200/50">
          {date}
        </span>
        <button
          onClick={onPin}
          title="Pin onto the canvas as a sticky"
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-amber-800/60 opacity-0 transition-opacity hover:bg-white/60 hover:text-amber-950 group-hover:opacity-100 dark:text-amber-200/60 dark:hover:bg-black/25"
        >
          <Pin className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onDelete}
          title="Delete this note"
          className="flex h-6 w-6 items-center justify-center rounded-md text-amber-800/60 opacity-0 transition-opacity hover:bg-white/60 hover:text-red-600 group-hover:opacity-100 dark:text-amber-200/60 dark:hover:bg-black/25"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
