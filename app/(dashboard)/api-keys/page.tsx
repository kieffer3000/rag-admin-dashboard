'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Providers a user can bring their own key for, to bill LLM usage to
 *  themselves. Stored in the browser (localStorage) — never committed. */
const PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    placeholder: 'sk-ant-…',
    dot: 'bg-orange-500'
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    placeholder: 'sk-…',
    dot: 'bg-emerald-500'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    placeholder: 'AIza…',
    dot: 'bg-blue-500'
  }
] as const;

const LS_KEY = 'answersdoc_api_keys';

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(LS_KEY);
      if (s) setKeys(JSON.parse(s));
    } catch {
      /* ignore */
    }
  }, []);

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(keys));
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch {
      /* ignore */
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
              Bring your own keys to pay for LLM usage on your own account.
            </p>
          </div>
        </div>

        <div className="mb-5 flex items-start gap-2.5 rounded-[14px] bg-emerald-500/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-foreground/80 ring-1 ring-emerald-500/15">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span>
            Keys are stored only in <strong>this browser</strong> (localStorage)
            and are never sent to our servers or committed anywhere. Leave a
            field blank to use the workspace default.
          </span>
        </div>

        <div className="space-y-4">
          {PROVIDERS.map((p) => (
            <div
              key={p.id}
              className="rounded-[16px] bg-card p-4 shadow-soft dark:ring-1 dark:ring-white/[0.06]"
            >
              <Label className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                <span className={cn('h-2 w-2 rounded-full', p.dot)} />
                {p.label}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  type={show[p.id] ? 'text' : 'password'}
                  value={keys[p.id] ?? ''}
                  onChange={(e) =>
                    setKeys((k) => ({ ...k, [p.id]: e.target.value }))
                  }
                  placeholder={p.placeholder}
                  autoComplete="off"
                  className="flex-1 font-mono text-[12.5px]"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => ({ ...s, [p.id]: !s[p.id] }))}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-[rgb(var(--hairline)/0.06)] hover:text-foreground"
                  title={show[p.id] ? 'Hide' : 'Show'}
                >
                  {show[p.id] ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button variant="accent" onClick={save}>
            {saved ? (
              <>
                <Check className="mr-1.5 h-4 w-4" /> Saved
              </>
            ) : (
              'Save keys'
            )}
          </Button>
          <p className="text-[11.5px] text-muted-foreground/65">
            Used for your brains&apos; LLM calls when set.
          </p>
        </div>
      </div>
    </div>
  );
}
