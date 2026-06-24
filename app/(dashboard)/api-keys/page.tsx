'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Check, Eye, EyeOff, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// BYOK: bring your own OpenRouter key. The LLM (chat + research) is billed to
// YOUR OpenRouter account; we cover the rest (search, embeddings, file
// processing). The key is encrypted on our servers and used only for your
// organization's LLM calls — never returned to the browser, never logged.
export default function ApiKeysPage() {
  const [hasKey, setHasKey] = useState(false);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/org-settings')
      .then((r) => r.json())
      .then((d) => setHasKey(!!d.hasOpenrouterKey))
      .catch(() => {});
  }, []);

  async function save() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/org-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openrouterKey: value.trim() })
      });
      if (r.ok) {
        setHasKey(true);
        setValue('');
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await fetch('/api/org-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openrouterKey: '' })
      });
      if (r.ok) setHasKey(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto scroll-clean">
      <div className="mx-auto max-w-[640px] px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-accent/10 text-accent">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">API Keys</h1>
            <p className="text-[13px] text-muted-foreground/80">
              Bring your own OpenRouter key — your AI usage is billed to your account.
            </p>
          </div>
        </div>

        <div className="mb-5 flex items-start gap-2.5 rounded-[14px] bg-emerald-500/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-foreground/80 ring-1 ring-emerald-500/15">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span>
            Your key is <strong>encrypted at rest</strong> and used only for your
            organization’s LLM calls — never shown again or logged. We cover search,
            embeddings, and file processing; you cover the model usage on{' '}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              OpenRouter
            </a>
            .
          </span>
        </div>

        <div className="rounded-[16px] bg-card p-4 shadow-soft dark:ring-1 dark:ring-white/[0.06]">
          <Label className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
            <span className="h-2 w-2 rounded-full bg-violet-500" />
            OpenRouter API key
            {hasKey && (
              <span className="ml-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                ✓ saved
              </span>
            )}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              type={show ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={hasKey ? 'Enter a new key to replace…' : 'sk-or-v1-…'}
              autoComplete="off"
              className="flex-1 font-mono text-[12.5px]"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
              title={show ? 'Hide' : 'Show'}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button variant="accent" onClick={save} disabled={busy || !value.trim()}>
            {saved ? (
              <>
                <Check className="mr-1.5 h-4 w-4" /> Saved
              </>
            ) : hasKey ? (
              'Replace key'
            ) : (
              'Save key'
            )}
          </Button>
          {hasKey && (
            <button
              onClick={remove}
              disabled={busy}
              className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
