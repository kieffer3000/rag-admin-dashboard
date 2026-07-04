'use client';

import { useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Upload, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ICON PICKER — a full emoji spread + "type any emoji" + image upload, shared
 * wherever something needs a face (agents, projects, …). Replaces the old
 * 10-emoji dropdowns. The uploaded image is downscaled to a small PNG data
 * URL so the state doc stays light.
 */

// A broad, categorized spread. Not the full Unicode set (thousands would jank
// the popover) — but wide enough that "the whole emoji list" feeling is there,
// and the free-text box below accepts literally ANY emoji the OS can type.
const EMOJI_SPREAD: { label: string; list: string }[] = [
  {
    label: 'Faces',
    list: '😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😜🤪🤨🧐🤓😎🥸🤠😏😴🤯🥶🥵😱🤗🤔🫡🤫😬🙄😮‍💨🤤😪'
  },
  {
    label: 'People & roles',
    list: '🧑‍💻👨‍💻👩‍💻🧑‍🔬👨‍🔬👩‍🔬🧑‍🏫👨‍🏫👩‍🏫🧑‍⚖️🧑‍⚕️👨‍⚕️👩‍⚕️🧑‍🍳🧑‍🔧🧑‍🏭🧑‍💼👨‍💼👩‍💼🧑‍🚀👮🕵️💂🥷👷🤴👸🧙🧛🧟🦸🦹🧞🧜🧚👼🎅🤶'
  },
  {
    label: 'Animals',
    list: '🐶🐱🐭🐹🐰🦊🐻🐼🐻‍❄️🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦆🦅🦉🦇🐺🐗🐴🦄🐝🐛🦋🐌🐞🐜🪲🐢🐍🦎🦂🦀🦞🦐🦑🐙🦈🐬🐳🐋🐊🐆🐅🐃🦍🦣🐘🦛🦏🐪🦒🦘🦬🐎🐖🐏🐑🦙🐐🦌🐕🐩🦮🐈🐓🦃🦤🦚🦜🦢🦩🕊🐇🦝🦨🦡🦫🦦🦥🐁🐀🐿🦔'
  },
  {
    label: 'Objects & tools',
    list: '💡🔦🕯💰💎⚙️🔧🔨🛠⛏🔩🧲🔫💣🧨🪓🔪🗡⚔️🛡🚬⚰️🪦⚱️🏺🔮📿🧿💈⚗️🔭🔬🕳🩹🩺💊💉🩸🧬🦠🧫🧪🌡🧹🪠🧺🧻🚽🚰🚿🛁🛀🧼🪥🪒🧽🪣🧴🛎🔑🗝🚪🪑🛋🛏🛌🧸🪆🖼🪞🪟🛍🛒🎁🎈🎏🎀🪄🪅🎊🎉🪩🎎🏮🎐🧧✉️📦📫📮🗳✏️✒️🖋🖊🖌🖍📝💼📁📂🗂📅📆🗒🗓📇📈📉📊📋📌📍📎🖇📏📐✂️🗃🗄🗑'
  },
  {
    label: 'Tech & science',
    list: '⌚📱💻⌨️🖥🖨🖱🖲🕹🗜💽💾💿📀📼📷📸📹🎥📽🎞📞☎️📟📠📺📻🎙🎚🎛🧭⏱⏲⏰🕰⌛⏳📡🔋🪫🔌🛰🚀🛸🤖👾🧠'
  },
  {
    label: 'Nature & food',
    list: '🌵🎄🌲🌳🌴🪴🌱🌿☘️🍀🎍🪵🎋🍃🍂🍁🍄🐚🪨🌾💐🌷🌹🥀🌺🌸🌼🌻🌞🌝🌛🌜🌚🌕🌎🪐💫⭐🌟✨⚡☄️💥🔥🌪🌈☀️⛅❄️🌊💧🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍈🍒🍑🥭🍍🥥🥝🍅🥑🍔🍟🍕🌭🥪🌮🌯🍜🍣🍩🍪🎂🍰🧁☕🍵🧃🥤🍺🍷🥂'
  },
  {
    label: 'Symbols & sport',
    list: '⚽🏀🏈⚾🎾🏐🎱🏓🏸🥊🥋🎽🛹🛼🏆🥇🥈🥉🏅🎖🎗🎫🎟🎪🎭🎨🎬🎤🎧🎼🎹🥁🎷🎺🎸🪕🎻🎲♟🎯🎳🎮🎰🧩❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟☮️✝️☪️🕉☸️✡️🔯🕎☯️☦️🛐⛎♈♉♊♋♌♍♎♏♐♑♒♓🆔⚛️✅❌❓❗💯🔞📵🚫💤🎵🎶➕➖➗✖️🟰💲💱™️©️®️🔴🟠🟡🟢🔵🟣⚫⚪🟤🔺🔻🔸🔹🔶🔷🔳🔲▪️▫️◾◽◼️◻️🟥🟧🟨🟩🟦🟪⬛⬜🟫'
  }
];

/** Split an emoji string into individual emoji (grapheme-aware). */
function splitEmoji(s: string): string[] {
  try {
    // Segmenter keeps ZWJ sequences (👨‍💻) and flags intact.
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return Array.from(seg.segment(s), (x) => x.segment).filter((g) => g.trim());
  } catch {
    return Array.from(s);
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function downscale(dataUrl: string, max = 224): Promise<string> {
  const img = new window.Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
    img.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/png');
}

export function IconPicker({
  icon,
  avatar,
  onIcon,
  onAvatar
}: {
  icon: string;
  avatar?: string;
  /** Choosing an emoji clears the avatar (they're exclusive). */
  onIcon: (emoji: string) => void;
  onAvatar: (dataUrl: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      onAvatar(await downscale(await blobToDataUrl(f)));
      setOpen(false);
    } catch {
      window.alert("Couldn't read that image — try another file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-12 items-center justify-center overflow-hidden rounded-xl border border-input bg-card text-xl"
          title="Pick an emoji or upload an image"
        >
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            icon || '🙂'
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-2">
        {/* upload / clear row */}
        <div className="mb-1.5 flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Upload image…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={onUpload}
          />
          {avatar && (
            <button
              type="button"
              onClick={() => onAvatar('')}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-muted-foreground hover:bg-secondary"
            >
              <X className="h-3 w-3" /> Clear image
            </button>
          )}
          <Input
            value={avatar ? '' : icon}
            onChange={(e) => {
              const gs = splitEmoji(e.target.value);
              onIcon(gs[gs.length - 1] ?? '');
            }}
            placeholder="any…"
            disabled={!!avatar}
            className="ml-auto h-7 w-14 text-center text-[15px]"
            title="Type any emoji from your keyboard"
          />
        </div>
        {/* the spread */}
        <div className="max-h-[300px] overflow-y-auto pr-1">
          {EMOJI_SPREAD.map((cat) => (
            <div key={cat.label}>
              <p className="px-1 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                {cat.label}
              </p>
              <div className="grid grid-cols-9 gap-0.5">
                {splitEmoji(cat.list).map((e) => (
                  <button
                    key={cat.label + e}
                    type="button"
                    onClick={() => {
                      onIcon(e);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg text-[17px] leading-none transition-colors hover:bg-secondary',
                      icon === e && !avatar && 'bg-accent/15 ring-1 ring-accent/40'
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
