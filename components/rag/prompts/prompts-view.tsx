'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useRag } from '@/lib/rag/store';
import { Prompt } from '@/lib/rag/types';
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
import { Plus, MoreHorizontal, Pencil, Trash2, MessagesSquare, Copy } from 'lucide-react';

const EMOJIS = ['🎓', '📝', '⚖️', '✨', '🃏', '🔍', '🧠', '💡', '📊', '🎯'];

export function PromptsView() {
  const { prompts, addPrompt, updatePrompt, deletePrompt, setActivePrompt } = useRag();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [icon, setIcon] = useState('✨');

  function startNew() {
    setEditing(null);
    setTitle('');
    setBody('');
    setIcon('✨');
    setOpen(true);
  }

  function startEdit(p: Prompt) {
    setEditing(p);
    setTitle(p.title);
    setBody(p.body);
    setIcon(p.icon ?? '✨');
    setOpen(true);
  }

  function save() {
    if (!title.trim() || !body.trim()) return;
    if (editing) {
      updatePrompt(editing.id, { title: title.trim(), body: body.trim(), icon });
    } else {
      addPrompt({ title: title.trim(), body: body.trim(), icon });
    }
    setOpen(false);
  }

  function usePrompt(p: Prompt) {
    setActivePrompt(p.id);
    router.push('/');
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/70 px-6 pt-6 lg:px-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Prompts</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Reusable instructions you can apply to any chat. {prompts.length} saved.
            </p>
          </div>
          <Button variant="accent" className="gap-1.5 rounded-xl" onClick={startNew}>
            <Plus className="h-4 w-4" /> New prompt
          </Button>
        </div>
        <div className="h-4" />
      </div>

      <div className="scroll-clean flex-1 overflow-y-auto px-6 py-5 lg:px-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {prompts.map((p) => (
            <div
              key={p.id}
              className="group flex flex-col rounded-2xl border border-border/70 bg-white p-4 shadow-soft transition-all hover:shadow-float"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-xl">
                  {p.icon ?? '✨'}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-secondary group-hover:opacity-100">
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => startEdit(p)} className="gap-2">
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => addPrompt({ title: `${p.title} copy`, body: p.body, icon: p.icon })}
                      className="gap-2"
                    >
                      <Copy className="h-3.5 w-3.5" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => deletePrompt(p.id)}
                      className="gap-2 text-red-600 focus:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <h3 className="mt-3 flex items-center gap-2 text-[15px] font-semibold">
                {p.title}
                {p.builtIn && (
                  <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Built-in
                  </span>
                )}
              </h3>
              <p className="mt-1.5 line-clamp-3 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                {p.body}
              </p>

              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full gap-1.5 rounded-xl"
                onClick={() => usePrompt(p)}
              >
                <MessagesSquare className="h-3.5 w-3.5" /> Use in chat
              </Button>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit prompt' : 'New prompt'}</DialogTitle>
            <DialogDescription>
              Prompts are prepended to your question to steer how Atlas answers.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="space-y-1.5">
                <Label>Icon</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex h-10 w-12 items-center justify-center rounded-xl border border-input bg-white text-xl">
                      {icon}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="grid grid-cols-5 gap-1 p-2">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        onClick={() => setIcon(e)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-secondary"
                      >
                        {e}
                      </button>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Explain like a tutor" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Instructions</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe how Atlas should respond…"
                className="min-h-[140px]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" disabled={!title.trim() || !body.trim()} onClick={save}>
              {editing ? 'Save changes' : 'Create prompt'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
