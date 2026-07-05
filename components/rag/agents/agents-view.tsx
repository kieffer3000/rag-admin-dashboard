'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRag } from '@/lib/rag/store';
import { useBoard } from '@/lib/rag/board/store';
import { Agent } from '@/lib/rag/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Plus, MoreHorizontal, Pencil, Trash2, Workflow, Copy } from 'lucide-react';
import { IconPicker } from '@/components/rag/icon-picker';

export function AgentsView() {
  const { agents, addAgent, updateAgent, deleteAgent } = useRag();
  const { board, updateBoardNodeData } = useBoard();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [icon, setIcon] = useState('🤖');
  const [avatar, setAvatar] = useState('');

  function startNew() {
    setEditing(null);
    setName('');
    setSystemPrompt('');
    setIcon('🤖');
    setAvatar('');
    setOpen(true);
  }

  function startEdit(a: Agent) {
    setEditing(a);
    setName(a.name);
    setSystemPrompt(a.systemPrompt);
    setIcon(a.icon ?? '🤖');
    setAvatar(a.avatar ?? '');
    setOpen(true);
  }

  function save() {
    if (!name.trim() || !systemPrompt.trim()) return;
    if (editing) {
      updateAgent(editing.id, {
        name: name.trim(),
        systemPrompt: systemPrompt.trim(),
        icon,
        avatar
      });
      // CONNECTED AGENTS: push the edit into every copy of this agent placed
      // on the current board, so the robot on the canvas never drifts from
      // the saved Agent.
      for (const n of board.nodes)
        if (n.type === 'agent' && n.data.agentId === editing.id)
          updateBoardNodeData(n.id, {
            name: name.trim(),
            icon: avatar ? '' : icon,
            avatar,
            text: systemPrompt.trim()
          });
    } else {
      addAgent({
        name: name.trim(),
        systemPrompt: systemPrompt.trim(),
        icon,
        avatar
      });
    }
    setOpen(false);
  }

  function useOnBoard() {
    router.push('/board');
  }

  return (
    <div className="h-full p-2.5">
      <div className="panel flex h-full flex-col overflow-hidden rounded-[26px]">
      <div className="border-b border-[rgb(var(--hairline)/0.08)] px-6 pt-6 lg:px-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Agents</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Reusable answering personas you can wire into any brain. {agents.length} saved.
            </p>
          </div>
          <Button variant="accent" className="gap-1.5 rounded-xl" onClick={startNew}>
            <Plus className="h-4 w-4" /> New agent
          </Button>
        </div>
        <div className="h-4" />
      </div>

      <div className="scroll-clean flex-1 overflow-y-auto px-6 py-5 lg:px-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <div
              key={a.id}
              className="card-glass hover-glow group flex flex-col rounded-[18px] p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-secondary text-xl">
                  {a.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.avatar}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    a.icon ?? '🤖'
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-[rgb(var(--hairline)/0.06)] group-hover:opacity-100">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => startEdit(a)} className="gap-2">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        addAgent({
                          name: `${a.name} copy`,
                          systemPrompt: a.systemPrompt,
                          icon: a.icon
                        })
                      }
                      className="gap-2"
                    >
                      <Copy className="h-3.5 w-3.5" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => deleteAgent(a.id)}
                      className="gap-2 text-red-600 focus:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <h3 className="mt-3 flex items-center gap-2 text-[15px] font-semibold">
                {a.name}
                {a.builtIn && (
                  <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Built-in
                  </span>
                )}
              </h3>
              <p className="mt-1.5 line-clamp-3 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                {a.systemPrompt}
              </p>

              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full gap-1.5 rounded-xl"
                onClick={useOnBoard}
              >
                <Workflow className="h-3.5 w-3.5" /> Use on board
              </Button>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit agent' : 'New agent'}</DialogTitle>
            <DialogDescription>
              An agent is an answering persona — drag it onto the board and wire it
              into a brain to steer how answersDoc answers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="space-y-1.5">
                <Label>Icon</Label>
                <IconPicker
                  icon={icon}
                  avatar={avatar}
                  onIcon={(e) => {
                    setIcon(e || '🤖');
                    setAvatar('');
                  }}
                  onAvatar={setAvatar}
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scholar" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>System prompt</Label>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Describe the persona — tone, stance, how it should answer…"
                className="min-h-[140px]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" disabled={!name.trim() || !systemPrompt.trim()} onClick={save}>
              {editing ? 'Save changes' : 'Create agent'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
