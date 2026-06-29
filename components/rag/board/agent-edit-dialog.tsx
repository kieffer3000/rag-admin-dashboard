'use client';

import { useEffect, useState } from 'react';
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
import { Bot } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';
import type { AgentData } from '@/lib/rag/board/types';

/** Edit a robot/agent — name, icon, and the system prompt that steers how the
 *  brain answers. Opened from the agent node's ✏️ button or the right-click menu
 *  (the store's `agentEditor` holds the node id). */
export function AgentEditDialog() {
  const { agentEditor, setAgentEditor, board, updateBoardNodeData } = useBoard();
  const node = agentEditor ? board.nodes.find((n) => n.id === agentEditor) : null;
  const d = (node?.data ?? {}) as AgentData;

  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [text, setText] = useState('');

  // Reload the fields whenever a different agent opens.
  useEffect(() => {
    if (node) {
      setName(d.name ?? '');
      setIcon(d.icon ?? '');
      setText(d.text ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentEditor]);

  function save() {
    if (!agentEditor) return;
    updateBoardNodeData(agentEditor, {
      name: name.trim() || 'Agent',
      icon: icon.trim(),
      text
    });
    setAgentEditor(null);
  }

  return (
    <Dialog open={!!agentEditor} onOpenChange={(o) => !o && setAgentEditor(null)}>
      <DialogContent className="max-w-xl border-emerald-500/30">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-emerald-500" />
            Edit agent
          </DialogTitle>
          <DialogDescription>
            The persona that steers <em>how</em> this brain answers — its system prompt
            rides into the brain&apos;s guidance. Never a source, never indexed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="w-16 space-y-1.5">
              <Label>Icon</Label>
              <Input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🤖"
                maxLength={4}
                className="text-center"
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dan Kennedy copywriter"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>System prompt</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="How should the brain answer? Tone, priorities, persona, format…"
              className="min-h-[220px] font-mono text-[12.5px] leading-relaxed"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => setAgentEditor(null)}>
            Cancel
          </Button>
          <Button
            onClick={save}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
