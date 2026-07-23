'use client';

import { useState } from 'react';
import { AudioLines, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu';
import { TTS_VOICES, getVoice, setVoice } from '@/lib/rag/tts-voice';
import { playVoiceover } from '@/lib/rag/board/voiceover';

/**
 * Global read-aloud VOICE picker (Build 3.40). Lives in the dashboard chrome
 * (rail bottom on desktop, top bar on mobile) beside the sound/theme toggles.
 * Choosing a voice saves the per-browser preference AND plays a short sample in
 * it — the item click is a user gesture, so the sample is allowed to play.
 */
export function VoicePicker({ rail = false }: { rail?: boolean }) {
  const [voice, setV] = useState(getVoice());

  function pick(id: string) {
    setVoice(id);
    setV(id);
    // Live sample so the choice is audible immediately.
    playVoiceover('Hello — this is how I sound reading your answers.', {
      voice: id
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Read-aloud voice"
          title="Read-aloud voice — pick who reads your answers"
          className={cn(
            'relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
            rail
              ? 'text-white/75 hover:bg-white/10 hover:text-white'
              : 'text-muted-foreground hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground'
          )}
        >
          <AudioLines className="h-[18px] w-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={rail ? 'start' : 'end'} className="w-56">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Read-aloud voice
        </DropdownMenuLabel>
        {TTS_VOICES.map((v) => (
          <DropdownMenuItem
            key={v.id}
            onClick={() => pick(v.id)}
            className="gap-2 text-[13px]"
          >
            <span className="flex-1">{v.label}</span>
            <Check
              className={cn(
                'h-3.5 w-3.5 text-accent',
                v.id === voice ? 'opacity-100' : 'opacity-0'
              )}
            />
          </DropdownMenuItem>
        ))}
        <div className="px-2 pb-1 pt-1.5 text-[10.5px] leading-tight text-muted-foreground/60">
          Applies to every answer read aloud. Picking one plays a sample.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
