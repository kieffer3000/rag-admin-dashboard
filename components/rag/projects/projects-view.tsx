'use client';

/**
 * PROJECTS — the "view all projects" directory. Every operation here is
 * membership-only and rides existing, already-hardened rails:
 *
 *  - Rename        → updateProject (server merge: incoming wins for shared ids)
 *  - Delete        → deleteProject (tombstoned; the ONLY way a project leaves
 *                    the server union). Deletes the GROUPING — never a file.
 *  - Files add/rm  → addSourcesToProject / removeSourceFromProject — edits the
 *                    project's sourceIds pointer list. The media itself lives
 *                    in the account-global Library and is NEVER touched here
 *                    (deleteMedia is deliberately not exposed on this page).
 *  - Add box       → the Library→Board pendingBox rail: switch active project,
 *                    queue {name, sourceIds}, navigate to /board; the board
 *                    materializes the box through its own guarded save path
 *                    once hydrated for that project. No cross-document writes.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRag } from '@/lib/rag/store';
import { Project, MediaItem } from '@/lib/rag/types';
import { MediaIcon } from '@/components/rag/shared';
import { HelpDot } from '@/components/rag/help-dot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Package,
  Files,
  ArrowRight,
  Check,
  X
} from 'lucide-react';

const PROJECT_EMOJIS = ['🧠', '🚀', '📚', '⚖️', '🔬', '💼', '🎓', '🏥', '🎨', '🏗️'];

/** Cap dialog lists so a 3,000-source project can't freeze the page. */
const LIST_CAP = 200;

const HELP_PAGE =
  'Every project, in one place: open it, rename it, manage which files it can see, start a box on its board, or delete it.\n\nData safety: nothing on this page can delete a file. Projects are pointer lists — adding or removing a file here only changes what the project points at; the file itself stays in the Library and in every other project.';
const HELP_FILES =
  "Files a project 'has' are pointers into the shared Library. Remove takes the file out of THIS project only — it stays in the Library and in every other project that uses it. Add points this project at a Library file.\n\nNote: removing a file here does not remove its chip from the project's board — cut it there too if you want it gone from the canvas.";
const HELP_BOX =
  "Pick files and name the box — you'll be taken to this project's Board where the box appears with those files docked inside, exactly like 'Send to box' from the Library.";

export function ProjectsView() {
  const {
    projects,
    activeProject,
    setActiveProject,
    addProject,
    updateProject,
    deleteProject,
    media,
    addSourcesToProject,
    removeSourceFromProject,
    setPendingBox
  } = useRag();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [filesFor, setFilesFor] = useState<Project | null>(null);
  const [boxFor, setBoxFor] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);

  const mediaById = useMemo(() => {
    const m = new Map<string, MediaItem>();
    for (const it of media) m.set(it.id, it);
    return m;
  }, [media]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      `${p.name} ${p.description}`.toLowerCase().includes(q)
    );
  }, [projects, query]);

  // `filesFor`/`boxFor`/... hold a snapshot from click time — resolve the LIVE
  // project so dialog edits (add/remove file) render immediately.
  const live = (p: Project | null) =>
    p ? projects.find((x) => x.id === p.id) ?? p : null;

  function openProject(p: Project, to: string = '/board') {
    if (p.id !== activeProject.id) setActiveProject(p.id);
    router.push(to);
  }

  return (
    <div className="h-full p-2.5">
      <div className="panel flex h-full flex-col overflow-hidden rounded-[26px]">
        {/* Header */}
        <div className="border-b border-[rgb(var(--hairline)/0.08)] px-6 pb-4 pt-6 lg:px-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
                Projects
                <HelpDot text={HELP_PAGE} />
              </h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {projects.length} project{projects.length === 1 ? '' : 's'} ·
                files are never deleted from here
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative hidden sm:block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search projects…"
                  className="h-9 w-56 rounded-xl pl-9"
                />
              </div>
              <Button
                variant="accent"
                className="h-9 rounded-xl"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="mr-1.5 h-4 w-4" /> New project
              </Button>
            </div>
          </div>
        </div>

        {/* Rows */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 lg:px-6">
          {visible.length === 0 && (
            <p className="px-2 py-8 text-center text-[13px] text-muted-foreground">
              No projects match “{query}”.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {visible.map((p) => {
              const isActive = p.id === activeProject.id;
              return (
                <div
                  key={p.id}
                  className="card-glass flex flex-wrap items-center gap-2.5 rounded-[14px] px-3 py-1.5"
                >
                  {/* 3.30: ONE dense line — icon · name · badge · counts ·
                      description stretched across the middle · buttons. The
                      old two-line block left a wide dead zone between the
                      name and the action buttons. */}
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[hsl(240_16%_96.5%)] text-base dark:bg-[rgb(255_255_255_/_0.06)]">
                    {p.icon}
                  </span>
                  <span className="min-w-0 max-w-[26%] truncate text-[13.5px] font-semibold">
                    {p.name}
                  </span>
                  {isActive && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10.5px] font-semibold text-accent">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  )}
                  <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">
                    {p.sourceIds.length} source
                    {p.sourceIds.length === 1 ? '' : 's'}
                  </span>
                  <p className="hidden min-w-0 flex-1 truncate text-[12px] text-muted-foreground/70 md:block">
                    {p.description || ''}
                    {p.createdAt ? `${p.description ? ' · ' : ''}created ${p.createdAt}` : ''}
                  </p>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="accent"
                      size="sm"
                      className="h-8 rounded-lg text-[12px]"
                      onClick={() => openProject(p)}
                    >
                      Open <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-lg text-[12px] text-muted-foreground"
                      onClick={() => setFilesFor(p)}
                    >
                      <Files className="mr-1 h-3.5 w-3.5" /> Files
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-lg text-[12px] text-muted-foreground"
                      onClick={() => setBoxFor(p)}
                      disabled={!p.sourceIds.length}
                      title={
                        p.sourceIds.length
                          ? 'Create a box on this project’s board'
                          : 'Add files to this project first'
                      }
                    >
                      <Package className="mr-1 h-3.5 w-3.5" /> Box
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-lg text-[12px] text-muted-foreground"
                      onClick={() => setRenaming(p)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Rename
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 rounded-lg p-0 text-muted-foreground hover:text-red-600"
                      title="Delete this project (files are never deleted)"
                      onClick={() => setDeleting(p)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <CreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(p) => {
          addProject(p);
          setCreateOpen(false);
        }}
      />
      <RenameDialog
        project={live(renaming)}
        onClose={() => setRenaming(null)}
        onSave={(id, patch) => {
          updateProject(id, patch);
          setRenaming(null);
        }}
      />
      <FilesDialog
        project={live(filesFor)}
        media={media}
        mediaById={mediaById}
        onAdd={(pid, ids) => addSourcesToProject(pid, ids)}
        onRemove={(pid, id) => removeSourceFromProject(pid, id)}
        onClose={() => setFilesFor(null)}
      />
      <BoxDialog
        project={live(boxFor)}
        mediaById={mediaById}
        onClose={() => setBoxFor(null)}
        onCreate={(p, name, ids) => {
          setBoxFor(null);
          if (p.id !== activeProject.id) setActiveProject(p.id);
          setPendingBox({ name, sourceIds: ids });
          router.push('/board');
        }}
      />
      <DeleteDialog
        project={live(deleting)}
        onClose={() => setDeleting(null)}
        onDelete={(id) => {
          deleteProject(id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

/* ---------------- create ---------------- */

function CreateDialog({
  open,
  onClose,
  onCreate
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (p: { name: string; icon: string; description: string }) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📚');
  const [description, setDescription] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project keeps its own sources, conversations and notes — come
            back anytime and pick up where you left off.
          </DialogDescription>
        </DialogHeader>
        <ProjectFields
          name={name}
          icon={icon}
          description={description}
          setName={setName}
          setIcon={setIcon}
          setDescription={setDescription}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="accent"
            disabled={!name.trim()}
            onClick={() => {
              onCreate({
                name: name.trim(),
                icon,
                description: description.trim()
              });
              setName('');
              setDescription('');
              setIcon('📚');
            }}
          >
            Create project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- rename ---------------- */

function RenameDialog({
  project,
  onClose,
  onSave
}: {
  project: Project | null;
  onClose: () => void;
  onSave: (id: string, patch: Partial<Project>) => void;
}) {
  // Key the editable state to the project being edited.
  const [forId, setForId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📚');
  const [description, setDescription] = useState('');
  if (project && forId !== project.id) {
    setForId(project.id);
    setName(project.name);
    setIcon(project.icon || '📚');
    setDescription(project.description || '');
  }
  return (
    <Dialog
      open={!!project}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setForId(null); // re-seed from the project on next open
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>
            Change the name, icon or description. Nothing else is touched —
            files, boards, chats and notes all stay exactly as they are.
          </DialogDescription>
        </DialogHeader>
        <ProjectFields
          name={name}
          icon={icon}
          description={description}
          setName={setName}
          setIcon={setIcon}
          setDescription={setDescription}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="accent"
            disabled={!name.trim() || !project}
            onClick={() =>
              project &&
              onSave(project.id, {
                name: name.trim(),
                icon,
                description: description.trim()
              })
            }
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectFields({
  name,
  icon,
  description,
  setName,
  setIcon,
  setDescription
}: {
  name: string;
  icon: string;
  description: string;
  setName: (v: string) => void;
  setIcon: (v: string) => void;
  setDescription: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="space-y-1.5">
          <Label>Icon</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex h-10 w-12 items-center justify-center rounded-xl border border-input bg-card text-xl">
                {icon}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="grid grid-cols-5 gap-1 p-2">
              {PROJECT_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setIcon(e)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-[rgb(var(--hairline)/0.06)]"
                >
                  {e}
                </button>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex-1 space-y-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Biology Exam Prep"
            autoFocus
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>
          Description{' '}
          <span className="normal-case text-muted-foreground">(optional)</span>
        </Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this project about?"
        />
      </div>
    </div>
  );
}

/* ---------------- files (membership only) ---------------- */

function FilesDialog({
  project,
  media,
  mediaById,
  onAdd,
  onRemove,
  onClose
}: {
  project: Project | null;
  media: MediaItem[];
  mediaById: Map<string, MediaItem>;
  onAdd: (projectId: string, sourceIds: string[]) => void;
  onRemove: (projectId: string, sourceId: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'in' | 'add'>('in');
  const [q, setQ] = useState('');

  const inProject = useMemo(() => {
    if (!project) return [];
    const ql = q.trim().toLowerCase();
    const list: MediaItem[] = [];
    for (const id of project.sourceIds) {
      const m = mediaById.get(id);
      if (!m) continue;
      if (ql && !`${m.name} ${m.description}`.toLowerCase().includes(ql))
        continue;
      list.push(m);
    }
    return list;
  }, [project, mediaById, q]);

  const addable = useMemo(() => {
    if (!project) return [];
    const inSet = new Set(project.sourceIds);
    const ql = q.trim().toLowerCase();
    return media.filter(
      (m) =>
        !inSet.has(m.id) &&
        (!ql || `${m.name} ${m.description}`.toLowerCase().includes(ql))
    );
  }, [project, media, q]);

  const list = tab === 'in' ? inProject : addable;
  const shown = list.slice(0, LIST_CAP);

  return (
    <Dialog
      open={!!project}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setQ('');
          setTab('in');
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {project?.icon} {project?.name} — files
            <HelpDot text={HELP_FILES} />
          </DialogTitle>
          <DialogDescription>
            Add or remove which Library files this project points at. Files are
            never deleted here — removing only un-points this project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-[rgb(var(--hairline)/0.06)] p-0.5">
            <button
              onClick={() => setTab('in')}
              className={cn(
                'rounded-[10px] px-3 py-1.5 text-[12px] font-medium transition-colors',
                tab === 'in'
                  ? 'bg-card shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              In project ({project?.sourceIds.length ?? 0})
            </button>
            <button
              onClick={() => setTab('add')}
              className={cn(
                'rounded-[10px] px-3 py-1.5 text-[12px] font-medium transition-colors',
                tab === 'add'
                  ? 'bg-card shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Add from Library
            </button>
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="h-8 rounded-lg pl-8 text-[12.5px]"
            />
          </div>
        </div>

        <div className="max-h-[46vh] min-h-[200px] overflow-y-auto rounded-xl border border-[rgb(var(--hairline)/0.08)]">
          {shown.length === 0 && (
            <p className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
              {tab === 'in'
                ? 'No files in this project yet — switch to “Add from Library”.'
                : 'Nothing to add — every matching Library file is already in this project.'}
            </p>
          )}
          {shown.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2.5 border-b border-[rgb(var(--hairline)/0.06)] px-3 py-2 last:border-b-0"
            >
              <MediaIcon type={m.type} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">{m.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {m.chunks ? `${m.chunks} chunks` : m.status}
                </p>
              </div>
              {tab === 'in' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-[11.5px] text-muted-foreground hover:text-red-600"
                  onClick={() => project && onRemove(project.id, m.id)}
                >
                  <X className="mr-1 h-3 w-3" /> Remove
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-[11.5px] text-accent"
                  onClick={() => project && onAdd(project.id, [m.id])}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              )}
            </div>
          ))}
          {list.length > LIST_CAP && (
            <p className="px-3 py-2 text-center text-[11px] text-muted-foreground">
              Showing {LIST_CAP} of {list.length} — refine the search to see
              the rest.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- add a box (pendingBox rail) ---------------- */

function BoxDialog({
  project,
  mediaById,
  onClose,
  onCreate
}: {
  project: Project | null;
  mediaById: Map<string, MediaItem>;
  onClose: () => void;
  onCreate: (project: Project, name: string, sourceIds: string[]) => void;
}) {
  const [name, setName] = useState('New box');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const candidates = useMemo(() => {
    if (!project) return [];
    const ql = q.trim().toLowerCase();
    const list: MediaItem[] = [];
    for (const id of project.sourceIds) {
      const m = mediaById.get(id);
      if (!m) continue;
      if (ql && !`${m.name} ${m.description}`.toLowerCase().includes(ql))
        continue;
      list.push(m);
    }
    return list;
  }, [project, mediaById, q]);

  const shown = candidates.slice(0, LIST_CAP);

  function reset() {
    setName('New box');
    setQ('');
    setPicked(new Set());
  }

  return (
    <Dialog
      open={!!project}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            New box in {project?.icon} {project?.name}
            <HelpDot text={HELP_BOX} />
          </DialogTitle>
          <DialogDescription>
            Pick the files to dock inside. You’ll land on this project’s Board
            with the box created.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Box name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search this project’s files…"
              className="h-8 rounded-lg pl-8 text-[12.5px]"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-lg text-[11.5px]"
            onClick={() =>
              setPicked((prev) => {
                const next = new Set(prev);
                const allIn = shown.every((m) => next.has(m.id));
                for (const m of shown)
                  allIn ? next.delete(m.id) : next.add(m.id);
                return next;
              })
            }
          >
            Select shown
          </Button>
        </div>

        <div className="max-h-[38vh] min-h-[160px] overflow-y-auto rounded-xl border border-[rgb(var(--hairline)/0.08)]">
          {shown.map((m) => {
            const on = picked.has(m.id);
            return (
              <button
                key={m.id}
                onClick={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    on ? next.delete(m.id) : next.add(m.id);
                    return next;
                  })
                }
                className={cn(
                  'flex w-full items-center gap-2.5 border-b border-[rgb(var(--hairline)/0.06)] px-3 py-2 text-left last:border-b-0',
                  on && 'bg-accent/[0.06]'
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    on
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-[rgb(var(--hairline)/0.25)]'
                  )}
                >
                  {on && <Check className="h-3 w-3" />}
                </span>
                <MediaIcon type={m.type} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                  {m.name}
                </span>
              </button>
            );
          })}
          {candidates.length > LIST_CAP && (
            <p className="px-3 py-2 text-center text-[11px] text-muted-foreground">
              Showing {LIST_CAP} of {candidates.length} — refine the search to
              see the rest.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[12px] text-muted-foreground">
            {picked.size} file{picked.size === 1 ? '' : 's'} selected
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                onClose();
                reset();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="accent"
              disabled={!picked.size || !project}
              onClick={() => {
                if (!project) return;
                onCreate(
                  project,
                  name.trim() || 'New box',
                  Array.from(picked)
                );
                reset();
              }}
            >
              <Package className="mr-1.5 h-4 w-4" /> Create box on Board
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- delete (typed-name guard) ---------------- */

function DeleteDialog({
  project,
  onClose,
  onDelete
}: {
  project: Project | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [typed, setTyped] = useState('');
  const match = !!project && typed.trim() === project.name;
  return (
    <Dialog
      open={!!project}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setTyped('');
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete {project?.icon} {project?.name}?
          </DialogTitle>
          <DialogDescription>
            This removes the project as a grouping. It cannot be undone from
            the app.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-[13px]">
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3">
            <p className="font-semibold text-red-600 dark:text-red-400">
              Goes away
            </p>
            <p className="mt-1 text-muted-foreground">
              The project entry, its chats and its notes.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3">
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">
              Stays safe
            </p>
            <p className="mt-1 text-muted-foreground">
              Every file. All {project?.sourceIds.length ?? 0} sources remain
              in the Library and in every other project that uses them. No
              media or vectors are deleted.
            </p>
          </div>
          <div className="space-y-1.5 pt-1">
            <Label>
              Type <span className="font-semibold">{project?.name}</span> to
              confirm
            </Label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={project?.name}
              autoFocus
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="ghost"
            onClick={() => {
              onClose();
              setTyped('');
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!match}
            onClick={() => {
              if (!project) return;
              onDelete(project.id);
              setTyped('');
            }}
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> Delete project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
