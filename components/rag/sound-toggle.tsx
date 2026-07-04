'use client';

import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { soundEnabled, setSoundEnabled } from '@/lib/rag/board/sound';

/** Global sound on/off — lives in the top bar next to the theme toggle
 *  (moved out of the board dock, which was overflowing). Same localStorage
 *  switch the board sounds read. */
export function SoundToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => setOn(soundEnabled()), []);
  return (
    <button
      onClick={() => {
        setSoundEnabled(!on);
        setOn(!on);
      }}
      aria-label={on ? 'Mute sounds' : 'Unmute sounds'}
      title={on ? 'Sounds on — click to mute' : 'Sounds off — click to unmute'}
      className="relative flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
    >
      {on ? (
        <Volume2 className="h-[18px] w-[18px]" />
      ) : (
        <VolumeX className="h-[18px] w-[18px] opacity-60" />
      )}
    </button>
  );
}
