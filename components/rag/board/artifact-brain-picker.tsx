'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Brain, Trash2 } from 'lucide-react';
import { useBoard } from '@/lib/rag/board/store';

/**
 * An artifact always belongs to exactly one brain. This picker opens when an
 * artifact is created with multiple brains present, or when its wire is cut —
 * letting the user choose which brain it goes to (or, on a cut, delete it).
 */
export function ArtifactBrainPicker() {
  const { brainPicker, setBrainPicker, connectArtifactToBrain, removeBoardNode, board } =
    useBoard();
  if (!brainPicker) return null;

  const brains = board.nodes.filter((n) => n.type === 'brain' && !n.parentId);
  const isCut = !!brainPicker.afterCutEdge;

  const pick = (brainId: string) => {
    connectArtifactToBrain(brainPicker.artId, brainId);
    setBrainPicker(null);
  };
  const del = () => {
    removeBoardNode(brainPicker.artId);
    setBrainPicker(null);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && setBrainPicker(null)}>
      <DialogContent className="max-w-sm border-indigo-500/30">
        <DialogHeader>
          <DialogTitle>{isCut ? 'Where should this Draft go?' : 'Connect Draft to an Answers Bank'}</DialogTitle>
          <DialogDescription>
            A Draft always belongs to one Answers Bank. Pick the Answers Bank it should be wired to
            {isCut ? ', or delete it.' : '.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 py-1">
          {brains.map((b) => (
            <button
              key={b.id}
              onClick={() => pick(b.id)}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-[13px] font-medium transition-colors hover:border-indigo-500/50 hover:bg-indigo-500/[0.06]"
            >
              <Brain className="h-4 w-4 text-indigo-500" />
              {(b.data?.name as string) || 'Answers Bank'}
            </button>
          ))}
          {brains.length === 0 && (
            <p className="px-1 py-2 text-[12px] text-muted-foreground">
              No brains on the board. Add one first.
            </p>
          )}
        </div>
        <div className="flex justify-between gap-2 pt-1">
          {isCut ? (
            <Button
              variant="ghost"
              onClick={del}
              className="text-red-600 hover:bg-red-500/10 hover:text-red-600"
            >
              <Trash2 className="mr-1 h-4 w-4" /> Delete artifact
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" onClick={() => setBrainPicker(null)}>
            {isCut ? 'Keep as is' : 'Cancel'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
