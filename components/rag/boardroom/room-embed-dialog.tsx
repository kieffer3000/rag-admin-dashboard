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
import { HelpDot } from '@/components/rag/help-dot';
import { Share2, Copy, Check, Trash2, Loader2, Landmark } from 'lucide-react';

// Compose an embeddable Boardroom: bundle already-PUBLISHED Banks into one
// public, domain-locked iframe. The customer pastes the snippet into any app —
// no keys in the page, no host-app code. See lib/rag/rooms.ts.

interface Conn {
  id: string;
  label: string;
  embed_slug: string;
  project_id: string | null;
}
interface Room {
  slug: string;
  label: string;
  member_ids: string[];
  allowed_origins: string[];
  allow_table: boolean;
}

const HELP = `An embeddable Boardroom — like a chat widget, but the whole room of experts.

Bundle your PUBLISHED Banks into one iframe; paste it into any dashboard. One question fans out to every seated expert. No login, no code in the host app — the secret keys stay on our server, and the iframe only runs on the domains you allow.

Publish a Bank first (Bank ⋮ → Connect) to make it available here.`;

export function RoomEmbedDialog({
  open,
  onOpenChange,
  projectId
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
}) {
  const [conns, setConns] = useState<Conn[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState('Boardroom');
  const [domains, setDomains] = useState('');
  const [allowTable, setAllowTable] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://dash.answersdoc.com';
  const snippet = (slug: string) =>
    `<iframe src="${origin}/embed/room/${slug}" width="720" height="640" style="border:1px solid #e2e8f0;border-radius:12px" title="Boardroom"></iframe>`;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cr, rr] = await Promise.all([fetch('/api/connections'), fetch('/api/rooms')]);
      const cd = cr.ok ? await cr.json() : { connections: [] };
      const rd = rr.ok ? await rr.json() : { rooms: [] };
      // Only Banks from THIS project that actually have an embed slug (published).
      const list: Conn[] = (cd.connections ?? []).filter(
        (c: Conn) => c.embed_slug && (!c.project_id || c.project_id === projectId)
      );
      setConns(list);
      setRooms(rd.rooms ?? []);
    } catch {
      setError('Could not load your published Banks.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const create = useCallback(async () => {
    setError('');
    if (picked.size === 0) {
      setError('Pick at least one Bank to seat in the room.');
      return;
    }
    const allowedOrigins = domains
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowedOrigins.length === 0) {
      setError('Add at least one website where the room may be embedded (e.g. https://app.acme.com).');
      return;
    }
    setCreating(true);
    try {
      const r = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: name.trim() || 'Boardroom',
          memberIds: [...picked],
          allowedOrigins,
          allowTable
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'Could not create the room.');
      setPicked(new Set());
      setDomains('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the room.');
    } finally {
      setCreating(false);
    }
  }, [picked, domains, name, allowTable, load]);

  const remove = useCallback(
    async (slug: string) => {
      if (!window.confirm('Delete this embedded room? Any site using its iframe will stop working.'))
        return;
      await fetch(`/api/rooms?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' });
      await load();
    },
    [load]
  );

  const copy = (slug: string) => {
    navigator.clipboard?.writeText(snippet(slug)).then(() => {
      setCopied(slug);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-accent" />
            Embed this Boardroom
            <HelpDot text={HELP} />
          </DialogTitle>
          <DialogDescription>
            Bundle your published Banks into one iframe and paste it into any app — no login, no code
            on their side.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Existing rooms */}
          {rooms.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground/60">
                Your embedded rooms
              </p>
              {rooms.map((rm) => (
                <div key={rm.slug} className="rounded-lg border border-border p-2.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-accent" />
                    <b className="text-[13px]">{rm.label}</b>
                    <span className="text-[11px] text-muted-foreground">
                      {rm.member_ids.length} seat{rm.member_ids.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => remove(rm.slug)}
                      title="Delete room"
                      className="ml-auto text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-black/[0.04] px-2 py-1 text-[11px] dark:bg-white/[0.06]">
                      {snippet(rm.slug)}
                    </code>
                    <Button size="sm" variant="outline" onClick={() => copy(rm.slug)} className="gap-1">
                      {copied === rm.slug ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      Copy
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Composer */}
          <div className="space-y-2.5 rounded-lg border border-dashed border-border p-3">
            <p className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground/60">
              New room
            </p>
            {loading ? (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your published Banks…
              </p>
            ) : conns.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No published Banks yet. Open a Bank&apos;s ⋮ menu → <b>Connect</b> to publish it, then
                come back — it&apos;ll be available to seat here.
              </p>
            ) : (
              <div className="space-y-1.5">
                <p className="text-[12px] text-muted-foreground">Seat these experts:</p>
                <div className="flex flex-wrap gap-1.5">
                  {conns.map((c) => {
                    const on = picked.has(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() =>
                          setPicked((prev) => {
                            const n = new Set(prev);
                            n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                            return n;
                          })
                        }
                        className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ring-1 transition-colors ${
                          on ? 'bg-accent text-white ring-accent' : 'ring-border hover:bg-accent/10'
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="text-[12px] font-medium">
                Room name
                <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-8 text-[13px]" />
              </label>
              <label className="text-[12px] font-medium">
                <span className="inline-flex items-center gap-1">
                  Allowed website(s)
                  <HelpDot text="The domains where this iframe is allowed to appear — a browser refuses to render it anywhere else. Space- or comma-separated, e.g. https://app.acme.com https://acme.com" />
                </span>
                <Input
                  value={domains}
                  onChange={(e) => setDomains(e.target.value)}
                  placeholder="https://app.acme.com"
                  className="mt-1 h-8 text-[13px]"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={allowTable}
                onChange={(e) => setAllowTable(e.target.checked)}
              />
              Allow tabling a document for critique
            </label>

            {error && <p className="text-[12.5px] font-medium text-red-600">{error}</p>}

            <Button size="sm" onClick={create} disabled={creating || conns.length === 0}>
              {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Create embed
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
