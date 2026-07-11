'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * HIGHLIGHT-TO-COPY (3.30, user request) — terminal-style: any text selected
 * anywhere in the dashboard is copied to the clipboard automatically, no
 * right-click → Copy needed. A quiet pill confirms it.
 *
 * Guards (each one earned):
 *  - EDITABLE surfaces are skipped (inputs / textareas / contenteditable) —
 *    select-to-replace while typing must never clobber the clipboard.
 *  - Debounced 350ms after mouseup/keyup so drag-selecting doesn't fire a
 *    copy per pixel.
 *  - Minimum 3 non-whitespace chars — a stray double-click on padding isn't
 *    a copy intent.
 *  - Same selection isn't re-copied twice in a row (keyup after mouseup).
 *  - navigator.clipboard needs focus + a secure context; failures are silent
 *    (the user still has the native copy path).
 */
export function SelectCopy() {
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let lastCopied = '';

    const isEditable = (n: Node | null): boolean => {
      const el =
        n instanceof Element ? n : n?.parentElement ? n.parentElement : null;
      return !!el?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
    };

    const maybeCopy = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString();
      if (text.trim().length < 3) return;
      if (text === lastCopied) return;
      if (isEditable(sel.anchorNode) || isEditable(sel.focusNode)) return;
      navigator.clipboard
        .writeText(text)
        .then(() => {
          lastCopied = text;
          setFlash(true);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlash(false), 1100);
        })
        .catch(() => {
          /* unfocused tab / permissions — native copy still works */
        });
    };

    const onDone = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(maybeCopy, 350);
    };

    document.addEventListener('mouseup', onDone);
    document.addEventListener('keyup', onDone); // shift+arrow selections
    return () => {
      document.removeEventListener('mouseup', onDone);
      document.removeEventListener('keyup', onDone);
      if (debounce) clearTimeout(debounce);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  if (!flash) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[100] -translate-x-1/2 rounded-full bg-foreground/90 px-3.5 py-1.5 text-[12px] font-medium text-background shadow-[0_6px_20px_rgb(0_0_0/0.25)]">
      Copied to clipboard
    </div>
  );
}
