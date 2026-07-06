'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Library,
  Bot,
  Activity,
  Users,
  KeyRound,
  ChevronsUpDown,
  Plus,
  Check,
  FolderOpen,
  Workflow
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BUILD_VERSION } from '@/lib/version';
import { RoundTableIcon } from '@/components/rag/round-table-icon';
import { useRag } from '@/lib/rag/store';
import { useIsAdmin } from '@/lib/rag/use-role';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const NAV = [
  // NOTE: the old Chat tab is retired (2026-07-04) — conversations live in
  // the DataBanks; '/' already redirected to /board anyway. ChatView code
  // stays in the tree, unrouted, in case it's ever wanted back.
  { href: '/board', label: 'Board', icon: Workflow },
  { href: '/boardroom', label: 'Boardroom', icon: RoundTableIcon },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/agents', label: 'Agents', icon: Bot },
  // Notes tab retired 2026-07-04 — notes live in the Board's Notes drawer
  // (dock 🗒 button / right-click a piece → Add note). Same store, same data.
  { href: '/health', label: 'Health', icon: Activity, adminOnly: true },
  { href: '/members', label: 'Team', icon: Users },
  { href: '/api-keys', label: 'API Keys', icon: KeyRound }
] as { href: string; label: string; icon: any; adminOnly?: boolean }[];

const PROJECT_EMOJIS = ['🧠', '🚀', '📚', '⚖️', '🔬', '💼', '🎓', '🏥', '🎨', '🏗️'];

export function ProjectSwitcher({ compact = false }: { compact?: boolean }) {
  const { projects, activeProject, setActiveProject, addProject } = useRag();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📚');
  const [description, setDescription] = useState('');

  function create() {
    if (!name.trim()) return;
    addProject({ name: name.trim(), icon, description: description.trim() });
    setName('');
    setDescription('');
    setIcon('📚');
    setCreateOpen(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-left transition-all',
              // 3.20: on the olive rail (compact) the tile keeps a FIXED
              // olive-glass look in BOTH themes — card-glass went bright white
              // in light mode and jumped out of the rail.
              compact
                ? 'w-auto bg-white/10 ring-1 ring-white/15 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:bg-white/[0.16]'
                : 'card-glass hover:brightness-[0.98]'
            )}
          >
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-base',
                compact
                  ? 'bg-white/10'
                  : 'bg-[hsl(240_16%_96.5%)] dark:bg-[rgb(255_255_255_/_0.06)]'
              )}
            >
              {activeProject.icon}
            </span>
            {!compact && (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-tight">
                  {activeProject.name}
                </span>
                <span className="block text-[11px] text-muted-foreground/70">
                  {activeProject.sourceIds.length} sources
                </span>
              </span>
            )}
            <ChevronsUpDown
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                compact ? 'text-white/70' : 'text-muted-foreground'
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <FolderOpen className="h-3 w-3" /> Projects
          </DropdownMenuLabel>
          {/* Big workspaces: ~8 rows visible, scroll to at most 13, everything
              else lives behind "View all projects…". The ACTIVE project is
              always kept in the list even when it would've been cut. */}
          {(() => {
            const MAX_LISTED = 13;
            let listed = projects;
            if (projects.length > MAX_LISTED) {
              listed = projects.slice(0, MAX_LISTED);
              if (!listed.some((p) => p.id === activeProject.id))
                listed = [...listed.slice(0, MAX_LISTED - 1), activeProject];
            }
            return (
              <div className="max-h-[416px] overflow-y-auto overscroll-contain">
                {listed.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => setActiveProject(p.id)}
                    className="gap-2.5"
                  >
                    <span className="text-base">{p.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{p.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {p.sourceIds.length} sources
                      </span>
                    </span>
                    <Check
                      className={cn(
                        'h-3.5 w-3.5 text-accent',
                        p.id === activeProject.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </DropdownMenuItem>
                ))}
              </div>
            );
          })()}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-2 text-accent">
            <Plus className="h-3.5 w-3.5" /> New project
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-2">
            <Link href="/projects">
              <FolderOpen className="h-3.5 w-3.5" />
              View all projects…
              {projects.length > 13 && (
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {projects.length}
                </span>
              )}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              A project keeps its own sources, conversations and notes — come back
              anytime and pick up where you left off.
            </DialogDescription>
          </DialogHeader>
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
                Description <span className="normal-case text-muted-foreground">(optional)</span>
              </Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project about?"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" disabled={!name.trim()} onClick={create}>
              Create project
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const isAdmin = useIsAdmin();

  // Make-style rail (2026-07-03): always compact, large icon + word beneath,
  // and a CONTRASTING brand-olive gradient so it reads as chrome, not canvas.
  // The old collapse toggle + "Vector store" info panel are gone.
  return (
    <aside className="hidden w-[96px] shrink-0 flex-col items-center gap-1 overflow-y-auto bg-gradient-to-b from-[hsl(66_48%_25%)] via-[hsl(70_45%_17%)] to-[hsl(76_42%_10%)] py-4 lg:flex">
      <Link href="/" className="mb-2 flex flex-col items-center gap-1.5">
        {/* 3.20: the white mark sits DIRECTLY on the olive rail (no tile box),
            Make.com-style — answersdoc-logo-white.png is the brand mark
            recolored white over the original alpha mask. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/answersdoc-logo-white.png"
          alt="answersDoc"
          className="h-12 w-12 shrink-0 object-contain drop-shadow-[0_3px_10px_rgb(0_0_0/0.35)]"
          draggable={false}
        />
      </Link>

      <div className="mb-2 flex justify-center">
        <ProjectSwitcher compact />
      </div>

      <nav className="flex w-full flex-col items-center gap-1 px-2">
        {NAV.filter((i) => isAdmin || !i.adminOnly).map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex w-full flex-col items-center gap-1 rounded-[14px] px-1 py-2 transition-all duration-150',
                active
                  ? 'bg-gradient-to-b from-white/[0.20] to-white/[0.09] text-white ring-1 ring-white/[0.14] shadow-[0_4px_14px_rgb(0_0_0/0.30),inset_0_1px_0_rgb(255_255_255/0.18)]'
                  : 'text-[#e6e4cf]/70 hover:bg-white/[0.08] hover:text-[#f4f2e3]'
              )}
            >
              <Icon
                className={cn(
                  'h-[22px] w-[22px] shrink-0 transition-colors',
                  active ? 'text-white' : 'text-[#e6e4cf]/70 group-hover:text-[#f4f2e3]'
                )}
              />
              <span className="text-[10px] font-semibold leading-none tracking-wide">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Build number — pinned to the rail's bottom. Bump rules in lib/version.ts. */}
      <div className="mt-auto pt-3">
        <span className="block text-center text-[9.5px] font-semibold tracking-wide text-[#e6e4cf]/45">
          Build {BUILD_VERSION}
        </span>
      </div>
    </aside>
  );
}
