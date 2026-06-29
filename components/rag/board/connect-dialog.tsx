'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plug, Copy, Check, Trash2, RefreshCw, Globe, Code2 } from 'lucide-react';

interface Conn {
  id: string;
  label: string;
  key_prefix: string;
  embed_slug: string;
  source_ids: string[];
  allowed_origins: string[];
  calls: number;
  created_at: string;
}

/** Publish an Answers Bank as an external, key-authed chat endpoint. Generates a
 *  per-Bank API key, snapshots its wired sources, and hands back an embed snippet
 *  + REST example. Opened from the Bank's ⋮ menu. */
export function ConnectDialog({
  open,
  onOpenChange,
  bankLabel,
  sourceIds,
  answerMode,
  model,
  speed
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  bankLabel: string;
  sourceIds: string[];
  answerMode: string;
  model: string;
  speed: string;
}) {
  const [conns, setConns] = useState<Conn[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [origins, setOrigins] = useState('');
  // Widget answer-mode: a fixed speed, or 'choice' = let the end-user pick.
  const [widgetMode, setWidgetMode] = useState<'fast' | 'detailed' | 'research' | 'choice'>(
    speed === 'fast' || speed === 'research' ? (speed as 'fast' | 'research') : 'detailed'
  );
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [freshConn, setFreshConn] = useState<Conn | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const hasRag = sourceIds.length > 0;
  const parsedOrigins = origins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/connections');
      const data = await res.json();
      setConns(Array.isArray(data.connections) ? data.connections : []);
    } catch {
      setConns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setFreshKey(null);
      setFreshConn(null);
      void load();
    }
  }, [open, load]);

  async function create() {
    setCreating(true);
    setFreshKey(null);
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: bankLabel,
          sourceIds,
          answerMode,
          model,
          speed: widgetMode === 'choice' ? 'detailed' : widgetMode,
          allowSpeedChoice: widgetMode === 'choice',
          allowedOrigins: parsedOrigins
        })
      });
      const data = await res.json();
      if (!res.ok) {
        window.alert(data?.error || 'Could not create the connection.');
        return;
      }
      setFreshKey(data.key);
      setFreshConn(data.connection ?? null);
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('Revoke this key? Anything using it stops working immediately.')) return;
    await fetch(`/api/connections?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    await load();
  }

  async function resync(id: string) {
    await fetch('/api/connections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        sourceIds,
        answerMode,
        model,
        speed: widgetMode === 'choice' ? 'detailed' : widgetMode,
        allowSpeedChoice: widgetMode === 'choice'
      })
    });
    await load();
    window.alert(`Re-synced — this key now answers from the Bank's current ${sourceIds.length} sources.`);
  }

  function copy(text: string, tag: string) {
    navigator.clipboard?.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(null), 1500);
  }

  // Embed uses the PUBLIC slug (safe to expose; domain-locked). The secret key is
  // only ever used server-side for REST and never appears in a URL.
  const embedSnippet = (slug: string) =>
    `<iframe src="${origin}/embed/${slug}" width="420" height="600" style="border:1px solid #e5e7eb;border-radius:16px" title="Ask the knowledge base"></iframe>`;
  const curlSnippet = (key: string) =>
    `curl -X POST ${origin}/api/v1/ask \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"question":"What does my knowledge base say about ...?"}'`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-accent/30">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-accent" />
            Connect “{bankLabel}” to another app
          </DialogTitle>
          <DialogDescription>
            Publish this Answers Bank as a key-authed chat endpoint. Drop the embed
            widget into any dashboard, or call the REST API. Read-only Q&amp;A over its{' '}
            <strong>{sourceIds.length}</strong> wired source{sourceIds.length === 1 ? '' : 's'}, with
            citations — your data and the retrieval pipeline never leave the server.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* create */}
          <div className="space-y-3 rounded-xl border border-accent/20 bg-accent/[0.04] p-3">
            {!hasRag ? (
              // Gate: a key is useless without a knowledge base to answer FROM.
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-700 dark:text-amber-300">
                <span>🔌</span>
                <span>
                  Connect a <strong>Library</strong> (your knowledge base / database) to this
                  Answers Bank before creating a key — there&apos;s nothing to answer from yet.
                </span>
              </p>
            ) : (
              <>
                {/* required domain lock */}
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5 text-[12px]">
                    <Globe className="h-3.5 w-3.5" /> Allowed website
                    <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    value={origins}
                    onChange={(e) => setOrigins(e.target.value)}
                    placeholder="https://my-seo-dashboard.com   (comma-separate several)"
                    className="h-9 text-[12.5px]"
                  />
                  <p className="text-[11px] text-muted-foreground/70">
                    Required. The key + widget only work on this domain — it can&apos;t be used
                    anywhere else.
                  </p>
                </div>

                {/* widget answer mode */}
                <div className="space-y-1.5">
                  <Label className="text-[12px]">Answer mode in the widget</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: 'fast', label: '⚡ Fast only' },
                        { id: 'detailed', label: '🔍 Normal only' },
                        { id: 'research', label: '🔭 Research only' },
                        { id: 'choice', label: '🎚️ Let users choose' }
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setWidgetMode(m.id)}
                        className={
                          'rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ' +
                          (widgetMode === m.id
                            ? 'bg-accent text-white'
                            : 'bg-card text-muted-foreground ring-1 ring-black/[0.06] hover:text-foreground dark:ring-white/[0.08]')
                        }
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground/70">
                    Lock everyone to one speed, or let the people using the widget pick Fast /
                    Normal / Research themselves.
                  </p>
                </div>

                <Button
                  onClick={create}
                  disabled={creating || parsedOrigins.length === 0}
                  className="h-9 w-full bg-accent text-white hover:bg-accent/90"
                >
                  {creating
                    ? 'Creating…'
                    : parsedOrigins.length === 0
                      ? 'Add an allowed website to continue'
                      : 'Create connection key'}
                </Button>
              </>
            )}
          </div>

          {/* freshly-created — the embed snippet (public slug) is always safe to
              paste; the secret API key is shown ONCE for server-side REST. */}
          {freshKey && freshConn && (
            <div className="space-y-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-3">
              <p className="text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                ✅ Connection created.
              </p>
              <KeyRow
                label={<span className="flex items-center gap-1"><Code2 className="h-3.5 w-3.5" /> Embed widget — paste into your dashboard (no secret key inside)</span>}
                value={embedSnippet(freshConn.embed_slug)}
                copied={copied === 'embed'}
                onCopy={() => copy(embedSnippet(freshConn.embed_slug), 'embed')}
              />
              <div className="rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-700 dark:text-amber-300">
                🔑 <strong>Secret API key — for server-to-server REST only.</strong> Copy it now,
                it won’t be shown again. Never put this in a web page or the iframe.
              </div>
              <KeyRow label="API key (secret)" value={freshKey} copied={copied === 'key'} onCopy={() => copy(freshKey, 'key')} mono />
              <KeyRow
                label="REST example (curl)"
                value={curlSnippet(freshKey)}
                copied={copied === 'curl'}
                onCopy={() => copy(curlSnippet(freshKey), 'curl')}
                mono
              />
            </div>
          )}

          {/* existing connections */}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Your connections
            </p>
            {loading ? (
              <p className="text-[12px] text-muted-foreground/70">Loading…</p>
            ) : conns.length === 0 ? (
              <p className="text-[12px] text-muted-foreground/70">
                No connections yet. Create one above to expose this Bank.
              </p>
            ) : (
              <div className="space-y-1.5">
                {conns.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <Plug className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium">{c.label}</div>
                      <div className="text-[10.5px] text-muted-foreground/70">
                        {c.key_prefix} · {c.source_ids.length} sources · {c.calls} calls
                        {c.allowed_origins.length > 0 && ` · ${c.allowed_origins.length} origin(s)`}
                      </div>
                    </div>
                    <button
                      title="Copy the embed snippet (public — safe to paste)"
                      onClick={() => copy(embedSnippet(c.embed_slug), `embed-${c.id}`)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]"
                    >
                      {copied === `embed-${c.id}` ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Code2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      title="Re-sync to this Bank's current sources"
                      onClick={() => resync(c.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      title="Revoke this key"
                      onClick={() => revoke(c.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-red-500/10 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KeyRow({
  label,
  value,
  copied,
  onCopy,
  mono
}: {
  label: React.ReactNode;
  value: string;
  copied: boolean;
  onCopy: () => void;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="flex items-start gap-1.5">
        <pre
          className={`min-w-0 flex-1 overflow-x-auto rounded-md bg-card px-2.5 py-1.5 text-[11.5px] ring-1 ring-black/[0.06] dark:ring-white/[0.08] ${
            mono ? 'font-mono' : ''
          }`}
        >
          {value}
        </pre>
        <button
          onClick={onCopy}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.07]"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
