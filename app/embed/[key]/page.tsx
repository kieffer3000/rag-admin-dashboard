'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

// PUBLIC embeddable chat widget. Drop into any dashboard via:
//   <iframe src="https://<app>/embed/<API_KEY>" width="420" height="600" />
// It calls /api/v1/ask with the key in the path. Read-only Q&A over one
// published Answers Bank, with citations. Self-contained styling so it looks
// right on any host page (no app chrome, no auth).

interface Citation {
  source_id: string;
  source_name?: string;
  snippet?: string;
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

export default function EmbedChatPage() {
  const params = useParams<{ key: string }>();
  // The path segment is the PUBLIC embed id (not the secret key). It's sent as
  // x-embed-id and only works from this widget, on an allowed domain.
  const embedId = params?.key ?? '';
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [bank, setBank] = useState('');
  const [allowSpeed, setAllowSpeed] = useState(false);
  const [speed, setSpeed] = useState<'fast' | 'detailed' | 'research'>('detailed');
  // Only run inside an iframe — a direct top-level visit (someone pasting the URL)
  // does nothing. Combined with the frame-ancestors CSP, the widget only works
  // when embedded on an allowed site.
  const [framed, setFramed] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true); // cross-origin access throws → we ARE framed
    }
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  // Pull the widget config (label + whether to offer the speed picker).
  useEffect(() => {
    if (!embedId || !framed) return;
    fetch('/api/v1/ask', { headers: { 'x-embed-id': embedId } })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (!cfg) return;
        if (cfg.bank) setBank(cfg.bank);
        setAllowSpeed(!!cfg.allowSpeedChoice);
        if (cfg.defaultSpeed === 'fast' || cfg.defaultSpeed === 'research' || cfg.defaultSpeed === 'detailed') {
          setSpeed(cfg.defaultSpeed);
        }
      })
      .catch(() => {});
  }, [embedId, framed]);

  const SPEEDS: { id: 'fast' | 'detailed' | 'research'; label: string }[] = [
    { id: 'fast', label: 'Fast' },
    { id: 'detailed', label: 'Normal' },
    { id: 'research', label: 'Research' }
  ];

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setQ('');
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: text }]);
    setBusy(true);
    try {
      const res = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-embed-id': embedId },
        body: JSON.stringify({ question: text, conversation: history, speed })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Request failed');
      if (data.bank) setBank(data.bank);
      setMsgs((m) => [
        ...m,
        { role: 'assistant', content: data.answer || '(no answer)', citations: data.citations || [] }
      ]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: 'assistant', content: `⚠️ ${(e as Error).message}` }
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!framed) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
          color: '#6b7280',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          fontSize: 13.5
        }}
      >
        This chat widget must be embedded on its website.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#fafafa',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        color: '#1a1a2e'
      }}
    >
      {/* header */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          background: 'linear-gradient(135deg,#6d28d9,#4f46e5)',
          color: '#fff'
        }}
      >
        <span style={{ fontSize: 18 }}>🏛️</span>
        <strong style={{ fontSize: 14 }}>{bank || 'Ask the knowledge base'}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.85 }}>cited answers</span>
      </div>

      {/* transcript */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {msgs.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: '#6b7280', fontSize: 13, maxWidth: 280 }}>
            Ask anything — every answer is grounded in this knowledge base and cited.
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.role === 'user' ? '#4f46e5' : '#fff',
              color: m.role === 'user' ? '#fff' : '#1a1a2e',
              border: m.role === 'user' ? 'none' : '1px solid #ececf0',
              borderRadius: 14,
              padding: '9px 12px',
              fontSize: 13.5,
              lineHeight: 1.5,
              boxShadow: m.role === 'user' ? 'none' : '0 1px 2px rgba(0,0,0,0.05)',
              whiteSpace: 'pre-wrap'
            }}
          >
            {m.content}
            {m.citations && m.citations.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {m.citations.slice(0, 6).map((c, j) => (
                  <span
                    key={j}
                    title={c.snippet || ''}
                    style={{
                      fontSize: 10.5,
                      background: '#eef2ff',
                      color: '#4338ca',
                      borderRadius: 999,
                      padding: '2px 7px',
                      maxWidth: 160,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {c.source_name || `[${j + 1}]`}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ alignSelf: 'flex-start', color: '#6b7280', fontSize: 13 }}>thinking…</div>
        )}
        <div ref={endRef} />
      </div>

      {/* speed picker — only when the publisher allows the choice */}
      {allowSpeed && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            gap: 4,
            padding: '8px 12px 0',
            background: '#fff'
          }}
        >
          {SPEEDS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSpeed(s.id)}
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '3px 11px',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                background: speed === s.id ? '#4f46e5' : '#eef2ff',
                color: speed === s.id ? '#fff' : '#4338ca'
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        style={{ flexShrink: 0, display: 'flex', gap: 8, padding: 12, borderTop: allowSpeed ? 'none' : '1px solid #ececf0', background: '#fff' }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask a question…"
          style={{
            flex: 1,
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: '10px 12px',
            fontSize: 13.5,
            outline: 'none'
          }}
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          style={{
            border: 'none',
            borderRadius: 12,
            padding: '0 16px',
            background: busy || !q.trim() ? '#c7d2fe' : '#4f46e5',
            color: '#fff',
            fontWeight: 600,
            fontSize: 13.5,
            cursor: busy || !q.trim() ? 'default' : 'pointer'
          }}
        >
          Ask
        </button>
      </form>
    </div>
  );
}
