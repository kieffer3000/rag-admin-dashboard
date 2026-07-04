'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessagesSquare,
  Library,
  Bot,
  StickyNote,
  Activity,
  Users,
  KeyRound,
  ChevronsUpDown,
  Plus,
  Check,
  FolderOpen,
  Workflow,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRag } from '@/lib/rag/store';
import { useIsAdmin } from '@/lib/rag/use-role';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
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
  { href: '/board', label: 'Board', icon: Workflow },
  { href: '/boardroom', label: 'Boardroom', icon: Landmark },
  { href: '/', label: 'Chat', icon: MessagesSquare },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/projects', label: 'Projects', icon: FolderOpen },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/notes', label: 'Notes', icon: StickyNote },
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
              'card-glass flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-left transition-all hover:brightness-[0.98]',
              compact && 'w-auto'
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[hsl(240_16%_96.5%)] text-base dark:bg-[rgb(255_255_255_/_0.06)]">
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
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            <FolderOpen className="h-3 w-3" /> Projects
          </DropdownMenuLabel>
          {projects.map((p) => (
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-2 text-accent">
            <Plus className="h-3.5 w-3.5" /> New project
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="gap-2">
            <Link href="/projects">
              <FolderOpen className="h-3.5 w-3.5" /> View all projects…
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
  const [collapsed, setCollapsed] = useState(false);

  // Persist the collapsed state across navigations/reloads.
  useEffect(() => {
    setCollapsed(localStorage.getItem('atlas-sidebar-collapsed') === '1');
  }, []);
  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem('atlas-sidebar-collapsed', next ? '1' : '0');
      return next;
    });
  }

  return (
    <aside
      className={cn(
        'hidden shrink-0 flex-col bg-transparent py-4 transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[72px] items-center px-2' : 'w-[228px] px-3'
      )}
    >
      <div
        className={cn(
          'mb-5 flex items-center',
          collapsed ? 'flex-col gap-2' : 'justify-between px-2'
        )}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[#efe9da] shadow-[0_4px_16px_hsl(var(--accent)/0.4)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/answersdoc-logo.png" alt="answersDoc" className="h-full w-full object-contain p-0.5" draggable={false} />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">answersDoc</div>
              <div className="text-[11px] text-muted-foreground/70">Knowledge Base</div>
            </div>
          )}
        </Link>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggle}
              className="flex h-7 w-7 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-[17px] w-[17px]" />
              ) : (
                <PanelLeftClose className="h-[17px] w-[17px]" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-[11.5px]">
            {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </TooltipContent>
        </Tooltip>
      </div>

      <div className={cn('mb-4', collapsed && 'flex justify-center')}>
        <ProjectSwitcher compact={collapsed} />
      </div>

      <nav className={cn('flex flex-col gap-1', collapsed && 'w-full items-center')}>
        {NAV.filter((i) => isAdmin || !i.adminOnly).map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          const link = (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center rounded-[14px] text-sm font-medium transition-all duration-150',
                collapsed ? 'h-10 w-10 justify-center' : 'gap-3 px-3 py-2.5',
                active
                  ? 'bg-accent/[0.08] font-semibold text-accent dark:bg-accent/[0.14]'
                  : 'text-muted-foreground hover:bg-[rgb(var(--hairline)/0.05)] hover:text-foreground'
              )}
            >
              <Icon
                className={cn(
                  'h-[18px] w-[18px] shrink-0 transition-colors',
                  active ? 'text-accent' : 'text-muted-foreground group-hover:text-foreground'
                )}
              />
              {!collapsed && item.label}
            </Link>
          );
          return collapsed ? (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right" className="text-[11.5px]">
                {item.label}
              </TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      {!collapsed && (
        <div className="panel mt-auto rounded-[20px] p-3.5">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <span className="relative flex h-2 w-2">
              {/* steady dot — the old animate-ping ring read as a constant flicker
                  once the board went quiet. A soft glow keeps the "live" feel. */}
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129/0.15)]" />
            </span>
            Vector store
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/70">
            Gemini Embedding · Pinecone
          </p>
        </div>
      )}
    </aside>
  );
}
