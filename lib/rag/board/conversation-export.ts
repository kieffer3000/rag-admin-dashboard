import { splitGraphicBlocks, sanitizeHtml } from '@/components/rag/board/markdown';
import { ChatMessage } from '@/lib/rag/types';

// Shared conversation exporter for an Answers Bank transcript — used by both the
// brain node's ⋯ menu and the Research overlay's top menu. Markdown (.md), plain
// text (.txt), Word (.doc via an HTML blob), or Print → the browser's Save-as-PDF.
// `scrollEl` is the rendered messages container; when given, already-rendered
// chart/diagram SVGs are captured (in DOM order) so exports show real graphics
// instead of raw ```chart JSON.

function escapeHtml(s: string): string {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string
  );
}

export function exportConversation(opts: {
  messages: ChatMessage[];
  title: string;
  format: 'md' | 'txt' | 'doc' | 'pdf';
  scrollEl?: HTMLElement | null;
}) {
  const { messages, format } = opts;
  const title = opts.title || 'Answers Bank';
  const graphics = opts.scrollEl
    ? Array.from(opts.scrollEl.querySelectorAll('[data-graphic]'))
    : [];
  let gi = 0;

  const answerHtml = (content: string): string =>
    splitGraphicBlocks(content)
      .map((s) => {
        if (s.type === 'prose') return s.text.trim() ? sanitizeHtml(s.text) : '';
        const el = graphics[gi++] as HTMLElement | undefined;
        if (el) return el.outerHTML;
        if (s.type === 'chart') {
          try {
            const spec = JSON.parse(s.text);
            const rows = (spec.data ?? [])
              .map(
                (d: Record<string, unknown>) =>
                  `<tr><td>${escapeHtml(String(d.name ?? ''))}</td>` +
                  Object.entries(d)
                    .filter(([k]) => k !== 'name')
                    .map(([, v]) => `<td>${escapeHtml(String(v))}</td>`)
                    .join('') +
                  `</tr>`
              )
              .join('');
            return `<figure><figcaption>${escapeHtml(
              spec.title ?? 'Chart'
            )}</figcaption><table>${rows}</table></figure>`;
          } catch {
            return '';
          }
        }
        return '';
      })
      .join('\n');

  const answerText = (content: string): string =>
    splitGraphicBlocks(content)
      .map((s) => {
        if (s.type === 'prose')
          return s.text
            .replace(/<[^>]+>/g, '')
            .replace(/&[a-z]+;/gi, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        if (s.type === 'chart') {
          try {
            const spec = JSON.parse(s.text);
            const rows = (spec.data ?? [])
              .map(
                (d: Record<string, unknown>) =>
                  `${d.name}: ${Object.entries(d)
                    .filter(([k]) => k !== 'name')
                    .map(([, v]) => v)
                    .join(', ')}`
              )
              .join('; ');
            return `[Chart: ${spec.title ?? spec.type}] ${rows}`;
          } catch {
            return s.text;
          }
        }
        return '[Diagram]';
      })
      .filter(Boolean)
      .join('\n\n');

  if (format === 'pdf' || format === 'doc') {
    const body =
      `<h1>${escapeHtml(title)}</h1>` +
      messages
        .filter((m) => m.content)
        .map((m) =>
          m.role === 'user'
            ? `<p class="u">You: ${escapeHtml(m.content)}</p>`
            : `<div class="a">${answerHtml(m.content)}</div>` +
              (m.citations?.length
                ? `<p class="s">Sources: ${m.citations
                    .map((c) => escapeHtml(`${c.mediaName} (${c.locator})`))
                    .join(', ')}</p>`
                : '')
        )
        .join('');
    const doc =
      `<html><head><title>${escapeHtml(title)}</title><meta charset="utf-8">` +
      `<style>body{font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#1a1a2e}` +
      `h1{font-size:20px}.u{font-weight:600;color:#4f46e5;margin-top:18px}.a{margin:6px 0 4px}.s{color:#666;font-size:12px}` +
      `svg{max-width:100%;height:auto}figure{border:1px solid #eee;border-radius:10px;padding:10px;margin:10px 0}figcaption{font-weight:600;margin-bottom:6px}` +
      `mark{background:#fef08a}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 8px;text-align:left}</style></head><body>` +
      body +
      `</body></html>`;
    if (format === 'pdf') {
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(doc);
      w.document.close();
      setTimeout(() => w.print(), 400);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([doc], { type: 'application/msword' }));
    a.download = `${title.replace(/[^\w-]+/g, '_')}.doc`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return;
  }

  // md / txt
  const text =
    `${format === 'md' ? '# ' : ''}${title}\n\n` +
    messages
      .filter((m) => m.content)
      .map((m) =>
        m.role === 'user'
          ? `${format === 'md' ? '**You:**' : 'You:'} ${m.content}`
          : `${answerText(m.content)}${
              m.citations?.length
                ? `\n\n${format === 'md' ? '_Sources: ' : 'Sources: '}${m.citations
                    .map((c) => `${c.mediaName} (${c.locator})`)
                    .join(', ')}${format === 'md' ? '_' : ''}`
                : ''
            }`
      )
      .join('\n\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([text], { type: format === 'md' ? 'text/markdown' : 'text/plain' })
  );
  a.download = `${title.replace(/[^\w-]+/g, '_')}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
