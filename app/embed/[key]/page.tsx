'use client';

import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

// PUBLIC embeddable chat widget. Drop into any dashboard via:
//   <iframe src="https://<app>/embed/<API_KEY>" width="420" height="600" />
// It calls /api/v1/ask with the key in the path. Read-only Q&A over one
// published Answers Bank, with citations. Self-contained styling so it looks
// right on any host page (no app chrome, no auth).

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

// Answers come back as HTML — render them, but strip anything dangerous first
// (scripts/styles/iframes, inline event handlers, javascript: URLs). Lightweight
// allowlist-ish scrub, since the widget is public.
function sanitizeAnswerHtml(html: string): string {
  let s = html ?? '';
  // drop whole dangerous elements + their contents
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, '');
  // strip inline event handlers (onclick=, onerror=, …)
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // neutralize javascript:/data: URLs in href/src
  s = s.replace(/(href|src)\s*=\s*("|')\s*(javascript|data):[^"']*\2/gi, '$1=$2#$2');
  return s;
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
      setMsgs((m) => [...m, { role: 'assistant', content: data.answer || '(no answer)' }]);
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
      {/* styling for rendered HTML answers — keeps lists, headings, links,
          code, tables readable inside the bubble. */}
      <style>{`
        .ad-answer > *:first-child { margin-top: 0; }
        .ad-answer > *:last-child { margin-bottom: 0; }
        .ad-answer p { margin: 0 0 8px; }
        .ad-answer ul, .ad-answer ol { margin: 0 0 8px; padding-left: 20px; }
        .ad-answer li { margin: 2px 0; }
        .ad-answer h1, .ad-answer h2, .ad-answer h3, .ad-answer h4 { margin: 12px 0 6px; font-weight: 700; line-height: 1.3; }
        .ad-answer h1 { font-size: 17px; } .ad-answer h2 { font-size: 15.5px; } .ad-answer h3 { font-size: 14px; }
        .ad-answer a { color: #4f46e5; text-decoration: underline; word-break: break-word; }
        .ad-answer strong { font-weight: 700; }
        .ad-answer code { background: #f1f1f4; border-radius: 4px; padding: 1px 4px; font-size: 12.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .ad-answer pre { background: #f6f6f8; border-radius: 8px; padding: 8px 10px; overflow-x: auto; margin: 0 0 8px; }
        .ad-answer pre code { background: none; padding: 0; }
        .ad-answer blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid #e5e7eb; color: #555; }
        .ad-answer table { border-collapse: collapse; width: 100%; margin: 0 0 8px; font-size: 12.5px; }
        .ad-answer th, .ad-answer td { border: 1px solid #e5e7eb; padding: 4px 7px; text-align: left; }
        .ad-answer img { max-width: 100%; height: auto; border-radius: 8px; }
        .ad-answer hr { border: none; border-top: 1px solid #ececf0; margin: 10px 0; }
      `}</style>
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
      </div>

      {/* transcript */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {msgs.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: '#6b7280', fontSize: 13, maxWidth: 280 }}>
            Ask anything — every answer is grounded in this knowledge base.
          </div>
        )}
        {msgs.map((m, i) => {
          const isUser = m.role === 'user';
          const common: React.CSSProperties = {
            alignSelf: isUser ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            background: isUser ? '#4f46e5' : '#fff',
            color: isUser ? '#fff' : '#1a1a2e',
            border: isUser ? 'none' : '1px solid #ececf0',
            borderRadius: 14,
            padding: '9px 12px',
            fontSize: 13.5,
            lineHeight: 1.5,
            boxShadow: isUser ? 'none' : '0 1px 2px rgba(0,0,0,0.05)'
          };
          // Assistant answers come back as HTML → render (sanitized). User text
          // stays plain (pre-wrap), so nothing they type is ever interpreted.
          return isUser ? (
            <div key={i} style={{ ...common, whiteSpace: 'pre-wrap' }}>
              {m.content}
            </div>
          ) : (
            <div
              key={i}
              className="ad-answer"
              style={common}
              dangerouslySetInnerHTML={{ __html: sanitizeAnswerHtml(m.content) }}
            />
          );
        })}
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
