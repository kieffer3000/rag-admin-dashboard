'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

// PUBLIC embeddable BOARDROOM widget. Drop into any dashboard via:
//   <iframe src="https://<app>/embed/room/<ROOM_SLUG>" width="720" height="640" />
// It reads the room's seated experts from /api/v1/room, then fans a question
// out to EACH expert in parallel via /api/v1/ask (or /api/v1/opine when a
// document is on the table) using that expert's public embed slug — same-origin,
// so the existing per-Bank embed auth trusts it. No secret keys in the page, no
// login, no host-app code. Frame-locked to allowed domains by middleware.

interface Expert {
  label: string;
  embedSlug: string;
}
interface Seat {
  label: string;
  embedSlug: string;
  status: 'idle' | 'thinking' | 'done' | 'error';
  answer?: string;
  citations?: Array<{ source_name?: string; snippet?: string }>;
  error?: string;
  ms?: number;
}
interface Turn {
  id: number;
  question: string;
  tabled?: string;
  seats: Seat[];
}

// Answers come back as HTML — scrub anything dangerous before rendering (public).
function sanitize(html: string): string {
  let s = html ?? '';
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, '');
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/(href|src)\s*=\s*("|')\s*(javascript|data):[^"']*\2/gi, '$1=$2#$2');
  return s;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'AB'
  );
}

const ROOM_GUIDE =
  'You are speaking in a boardroom meeting. Answer in the first person, in your own voice, and keep it under 150 words unless asked for depth. Take a position — if you disagree with common advice, say so plainly.';

export default function RoomEmbedPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';

  const [label, setLabel] = useState('Boardroom');
  const [experts, setExperts] = useState<Expert[]>([]);
  const [allowTable, setAllowTable] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [loaded, setLoaded] = useState(false);

  const [seatedOff, setSeatedOff] = useState<Set<string>>(new Set()); // excused
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [tabled, setTabled] = useState<{ title: string; content: string } | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [openSrc, setOpenSrc] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [framed, setFramed] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const turnId = useRef(0);

  useEffect(() => {
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true);
    }
  }, []);

  // Load the room config (labels + public embed slugs).
  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const r = await fetch('/api/v1/room', { headers: { 'x-room-id': slug } });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || 'Could not load this room.');
        setLabel(d.label || 'Boardroom');
        setExperts(Array.isArray(d.experts) ? d.experts : []);
        setAllowTable(d.allowTable !== false);
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : 'Could not load this room.');
      } finally {
        setLoaded(true);
      }
    })();
  }, [slug]);

  useEffect(() => {
    if (!busy) return;
    setClock(0);
    const iv = setInterval(() => setClock((c) => c + 1), 1000);
    return () => clearInterval(iv);
  }, [busy]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const seated = experts.filter((e) => !seatedOff.has(e.embedSlug));

  const consult = useCallback(
    async (tid: number, expert: Expert, question: string, art: { title: string; content: string } | null) => {
      const started = Date.now();
      const patch = (p: Partial<Seat>) =>
        setTurns((prev) =>
          prev.map((t) =>
            t.id !== tid
              ? t
              : {
                  ...t,
                  seats: t.seats.map((s) =>
                    s.embedSlug === expert.embedSlug ? { ...s, ...p } : s
                  )
                }
          )
        );
      patch({ status: 'thinking', error: undefined });
      try {
        const hdr = { 'Content-Type': 'application/json', 'x-embed-id': expert.embedSlug };
        let res: Response;
        if (art) {
          res = await fetch('/api/v1/opine', {
            method: 'POST',
            headers: hdr,
            body: JSON.stringify({
              instruction: `${question}\n\n(${ROOM_GUIDE})`,
              artifact: { title: art.title, content: art.content },
              citations: 'on'
            })
          });
        } else {
          res = await fetch('/api/v1/ask', {
            method: 'POST',
            headers: hdr,
            body: JSON.stringify({ question: `${question}\n\n(${ROOM_GUIDE})` })
          });
        }
        const d = await res.json();
        if (!res.ok) throw new Error(d?.error || `Failed (${res.status})`);
        patch({
          status: 'done',
          answer: sanitize(String(d.answer ?? '')),
          citations: Array.isArray(d.citations) ? d.citations : undefined,
          ms: Date.now() - started
        });
      } catch (e) {
        patch({
          status: 'error',
          error: e instanceof Error ? e.message : 'No answer.',
          ms: Date.now() - started
        });
      }
    },
    []
  );

  const ask = useCallback(async () => {
    const question = q.trim();
    if (!question || !seated.length || busy) return;
    setQ('');
    setBusy(true);
    const tid = ++turnId.current;
    const art = tabled;
    setTurns((prev) => [
      ...prev,
      {
        id: tid,
        question,
        tabled: art?.title,
        seats: seated.map((e) => ({ label: e.label, embedSlug: e.embedSlug, status: 'thinking' }))
      }
    ]);
    await Promise.all(seated.map((e) => consult(tid, e, question, art)));
    setBusy(false);
  }, [q, seated, busy, tabled, consult]);

  const mm = Math.floor(clock / 60);
  const ss = String(clock % 60).padStart(2, '0');

  if (!framed) {
    return (
      <div style={S.center}>
        <p style={{ color: '#64748b', fontSize: 14, textAlign: 'center', maxWidth: 340 }}>
          This is an embeddable boardroom. Add it to your site with an{' '}
          <code>&lt;iframe&gt;</code> — it only runs when embedded on an allowed domain.
        </p>
      </div>
    );
  }
  if (loaded && loadErr) {
    return (
      <div style={S.center}>
        <p style={{ color: '#dc2626', fontSize: 14, textAlign: 'center' }}>{loadErr}</p>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      {/* Header + seats */}
      <div style={S.header}>
        <div style={S.brandRow}>
          <span style={S.brandDot}>🏛</span>
          <b style={{ fontSize: 15 }}>{label}</b>
        </div>
        <div style={S.seatRow}>
          {!loaded ? (
            <span style={{ color: '#94a3b8', fontSize: 13 }}>Setting the chairs…</span>
          ) : experts.length === 0 ? (
            <span style={{ color: '#94a3b8', fontSize: 13 }}>No experts are seated in this room.</span>
          ) : (
            experts.map((e) => {
              const off = seatedOff.has(e.embedSlug);
              return (
                <button
                  key={e.embedSlug}
                  onClick={() =>
                    setSeatedOff((prev) => {
                      const n = new Set(prev);
                      n.has(e.embedSlug) ? n.delete(e.embedSlug) : n.add(e.embedSlug);
                      return n;
                    })
                  }
                  title={off ? `Seat ${e.label}` : `Excuse ${e.label}`}
                  style={{ ...S.seat, ...(off ? S.seatOff : {}) }}
                >
                  <span style={S.avatar}>{initials(e.label)}</span>
                  <span style={S.seatName}>{e.label}</span>
                </button>
              );
            })
          )}
        </div>
        {allowTable &&
          (tabled ? (
            <div style={S.tableBar}>
              📄 On the table: <b>&nbsp;{tabled.title}</b>
              <button onClick={() => setTabled(null)} style={S.tableX} title="Remove">
                ✕
              </button>
            </div>
          ) : tableOpen ? (
            <TableForm
              onSet={(t) => {
                setTabled(t);
                setTableOpen(false);
              }}
              onCancel={() => setTableOpen(false)}
            />
          ) : (
            <button onClick={() => setTableOpen(true)} style={S.tableLink}>
              📄 Table a document — the room will critique it
            </button>
          ))}
      </div>

      {/* Transcript */}
      <div style={S.transcript}>
        {turns.length === 0 ? (
          <div style={S.empty}>
            {seated.length
              ? `${seated.length} expert${seated.length > 1 ? 's' : ''} seated. Ask the room anything — each answers in their own voice.`
              : 'Seat an expert above, then ask the room.'}
          </div>
        ) : (
          turns.map((t) => (
            <div key={t.id} style={{ marginBottom: 18 }}>
              <div style={S.qRow}>
                <div style={S.qBubble}>
                  {t.question}
                  {t.tabled && <div style={S.qRe}>re: {t.tabled}</div>}
                </div>
              </div>
              {t.seats.map((s) => (
                <div key={s.embedSlug} style={S.aRow}>
                  <span style={S.avatar}>{initials(s.label)}</span>
                  <div style={S.aBubble}>
                    <div style={S.aName}>
                      {s.label}
                      {s.status === 'done' && s.ms != null && (
                        <span style={S.ms}>{Math.round(s.ms / 1000)}s</span>
                      )}
                    </div>
                    {s.status === 'thinking' ? (
                      <div style={S.thinking}>
                        {s.label} is thinking… {mm}:{ss}
                      </div>
                    ) : s.status === 'error' ? (
                      <div style={{ color: '#dc2626', fontSize: 13 }}>
                        {s.error}{' '}
                        <button
                          onClick={() =>
                            consult(t.id, { label: s.label, embedSlug: s.embedSlug }, t.question, tabled)
                          }
                          style={S.retry}
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <>
                        <div
                          style={S.answer}
                          dangerouslySetInnerHTML={{ __html: s.answer ?? '' }}
                        />
                        {(s.citations?.length ?? 0) > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <button
                              onClick={() =>
                                setOpenSrc((o) =>
                                  o === `${t.id}:${s.embedSlug}` ? null : `${t.id}:${s.embedSlug}`
                                )
                              }
                              style={S.srcBtn}
                            >
                              📖 source?
                            </button>
                            {openSrc === `${t.id}:${s.embedSlug}` && (
                              <ul style={S.srcList}>
                                {s.citations!.slice(0, 6).map((c, i) => (
                                  <li key={i} style={{ marginBottom: 4 }}>
                                    <b>{c.source_name ?? 'source'}</b> —{' '}
                                    <span style={{ color: '#64748b' }}>
                                      {(c.snippet ?? '').slice(0, 160)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div style={S.composer}>
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          rows={2}
          placeholder={seated.length ? 'Ask the room…' : 'Seat an expert first'}
          disabled={!seated.length}
          style={S.textarea}
        />
        <button onClick={ask} disabled={!q.trim() || !seated.length || busy} style={S.send}>
          {busy ? '…' : 'Ask'}
        </button>
      </div>
      <div style={S.footer}>Powered by AnswersDoc</div>
    </div>
  );
}

function TableForm({
  onSet,
  onCancel
}: {
  onSet: (t: { title: string; content: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  return (
    <div style={{ marginTop: 8 }}>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (e.g. 'Launch plan')"
        style={S.tInput}
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        placeholder="Paste the document to put on the table…"
        style={{ ...S.tInput, resize: 'vertical' as const }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() =>
            content.trim() && onSet({ title: title.trim() || 'Untitled', content: content.trim() })
          }
          disabled={!content.trim()}
          style={S.tSet}
        >
          Put on the table
        </button>
        <button onClick={onCancel} style={S.tCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Self-contained styles so the widget looks right on any host page.
const ACCENT = '#4f46e5';
const S: Record<string, React.CSSProperties> = {
  center: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' },
  wrap: { height: '100vh', display: 'flex', flexDirection: 'column', background: '#fbfbfd', fontFamily: 'system-ui, sans-serif', color: '#0f172a' },
  header: { borderBottom: '1px solid #e2e8f0', padding: '10px 14px', background: '#fff' },
  brandRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  brandDot: { fontSize: 18 },
  seatRow: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 },
  seat: { display: 'flex', alignItems: 'center', gap: 7, padding: '5px 9px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', flexShrink: 0 },
  seatOff: { opacity: 0.45 },
  avatar: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 999, background: '#eef2ff', color: ACCENT, fontWeight: 700, fontSize: 11, flexShrink: 0 },
  seatName: { fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' },
  tableBar: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 12.5, color: '#334155' },
  tableX: { marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' },
  tableLink: { marginTop: 8, border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12.5, padding: 0 },
  transcript: { flex: 1, overflowY: 'auto', padding: '14px' },
  empty: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: '#94a3b8', fontSize: 13.5, maxWidth: 440, margin: '0 auto' },
  qRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 10 },
  qBubble: { maxWidth: '80%', background: ACCENT, color: '#fff', padding: '8px 12px', borderRadius: '14px 14px 4px 14px', fontSize: 13.5 },
  qRe: { fontSize: 11, opacity: 0.8, marginTop: 3 },
  aRow: { display: 'flex', gap: 8, marginBottom: 10 },
  aBubble: { flex: 1, background: '#fff', border: '1px solid #e2e8f0', padding: '9px 12px', borderRadius: '4px 14px 14px 14px' },
  aName: { fontSize: 12, fontWeight: 700, color: ACCENT, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 6 },
  ms: { fontWeight: 400, color: '#94a3b8' },
  thinking: { fontSize: 13, fontStyle: 'italic', color: '#94a3b8' },
  answer: { fontSize: 13.5, lineHeight: 1.55 },
  srcBtn: { border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', fontSize: 11.5, fontWeight: 600, padding: 0 },
  srcList: { marginTop: 6, background: '#f8fafc', borderRadius: 8, padding: 8, fontSize: 12, listStyle: 'none' },
  retry: { border: 'none', background: '#fee2e2', borderRadius: 6, padding: '1px 6px', cursor: 'pointer', fontSize: 11, fontWeight: 600 },
  composer: { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #e2e8f0', background: '#fff', alignItems: 'flex-end' },
  textarea: { flex: 1, resize: 'none', borderRadius: 10, border: '1px solid #e2e8f0', padding: '9px 11px', fontSize: 13.5, fontFamily: 'inherit' },
  send: { height: 42, padding: '0 16px', borderRadius: 10, border: 'none', background: ACCENT, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13.5 },
  footer: { textAlign: 'center', fontSize: 10.5, color: '#cbd5e1', padding: '4px 0 8px' },
  tInput: { width: '100%', boxSizing: 'border-box', marginBottom: 6, borderRadius: 8, border: '1px solid #e2e8f0', padding: '7px 9px', fontSize: 12.5, fontFamily: 'inherit' },
  tSet: { borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', fontWeight: 600, padding: '5px 11px', cursor: 'pointer', fontSize: 12 },
  tCancel: { borderRadius: 8, border: 'none', background: '#f1f5f9', color: '#475569', padding: '5px 11px', cursor: 'pointer', fontSize: 12 }
};
