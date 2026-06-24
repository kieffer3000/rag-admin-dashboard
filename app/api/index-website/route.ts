import { auth } from '@clerk/nextjs/server';
import { indexText } from '@/lib/rag/index-core';
import { nsForUser } from '@/lib/rag/namespace';

// Website ingestion — with guardrails (see legal/risk notes):
//  • USER-INITIATED, single URL — not a crawler.
//  • Respects robots.txt for our user-agent; refuses if disallowed.
//  • PUBLIC pages only: no cookies/auth sent, so it can never bypass a paywall
//    or login. 401/403/451 → reported as "private/paywalled", not retried.
//  • Deterministic readable-text extraction (no LLM), then the SAME text
//    pipeline (chunk → Make embedding → Pinecone). Stored PRIVATELY in the
//    user's namespace; retrieval returns short cited snippets that link back.
//
// Soft failures (robots-blocked / paywalled / illegible) return HTTP 200 with
// { ok:false, note } so the client can show the user a clear message instead of
// a generic error.

export const runtime = 'nodejs';
export const maxDuration = 120;

const UA =
  'answersDocBot/1.0 (+https://answersdoc.vercel.app/bot; user-initiated; respects robots.txt)';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB of HTML
const MIN_TEXT = 200; // below this = effectively illegible / gated

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function extractTitle(html: string): string {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  if (og) return decodeEntities(og[1]).replace(/\s+/g, ' ').trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? decodeEntities(t[1]).replace(/\s+/g, ' ').trim() : '';
}

/** Deterministic HTML → readable text: drop non-content regions, turn block
 *  elements into newlines, strip tags, decode entities, collapse whitespace. */
function htmlToText(html: string): string {
  let h = html;
  h = h.replace(/<!--[\s\S]*?-->/g, ' ');
  h = h.replace(
    /<(script|style|noscript|svg|head|nav|header|footer|aside|form|template|iframe)[\s\S]*?<\/\1>/gi,
    ' '
  );
  h = h.replace(/<br\s*\/?>/gi, '\n');
  h = h.replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi, '\n');
  h = h.replace(/<[^>]+>/g, ' ');
  h = decodeEntities(h);
  h = h.replace(/[ \t\f\v]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
  return h.trim();
}

/** Minimal RFC-9309-ish robots.txt check for our UA on the target path. */
async function robotsAllows(target: URL): Promise<boolean> {
  try {
    const res = await fetch(`${target.origin}/robots.txt`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return true; // no robots / unreachable → allowed
    const lines = (await res.text()).split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());

    const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
    let g: { agents: string[]; rules: { allow: boolean; path: string }[] } | null = null;
    for (const line of lines) {
      const m = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
      if (!m) continue;
      const field = m[1].toLowerCase();
      const val = m[2].trim();
      if (field === 'user-agent') {
        if (g && g.rules.length === 0) g.agents.push(val);
        else groups.push((g = { agents: [val], rules: [] }));
      } else if (g) {
        g.rules.push({ allow: field === 'allow', path: val });
      }
    }
    const uaToken = 'answersdocbot';
    const chosen =
      groups.find((gr) => gr.agents.some((a) => a.toLowerCase() === uaToken)) ??
      groups.find((gr) => gr.agents.some((a) => a === '*'));
    if (!chosen) return true;

    const path = target.pathname + target.search;
    let best: { allow: boolean; len: number } | null = null;
    for (const r of chosen.rules) {
      if (r.path === '') continue;
      if (path.startsWith(r.path)) {
        if (!best || r.path.length > best.len || (r.path.length === best.len && r.allow)) {
          best = { allow: r.allow, len: r.path.length };
        }
      }
    }
    return best ? best.allow : true;
  } catch {
    return true; // robots unreachable → don't block
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { source_id, name, url } = body ?? {};
  if (!source_id || !url) {
    return Response.json({ error: 'source_id and url are required' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(String(url));
  } catch {
    return Response.json({ ok: false, note: 'That doesn’t look like a valid URL.' }, { status: 200 });
  }
  if (!/^https?:$/.test(target.protocol)) {
    return Response.json({ ok: false, note: 'Only http(s) links can be read.' }, { status: 200 });
  }
  // SSRF guard — never fetch private/loopback hosts.
  const host = target.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    /\.local$/.test(host) ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1'
  ) {
    return Response.json({ ok: false, note: 'That host isn’t publicly reachable.' }, { status: 200 });
  }

  // Guardrail: robots.txt.
  if (!(await robotsAllows(target))) {
    return Response.json(
      {
        ok: false,
        note:
          'This site’s robots.txt asks automated readers not to fetch that page, so I’ll skip it. Try a page the site allows, or add the text yourself.'
      },
      { status: 200 }
    );
  }

  // Fetch the page — public only (no cookies/auth → can’t bypass a paywall).
  let html = '';
  try {
    const res = await fetch(target.toString(), {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    });
    if (res.status === 401 || res.status === 403 || res.status === 451) {
      return Response.json(
        {
          ok: false,
          note:
            'This page looks private or paywalled — I can only read publicly accessible pages, and I won’t bypass a login or paywall.'
        },
        { status: 200 }
      );
    }
    if (!res.ok) {
      return Response.json(
        { ok: false, note: `Couldn’t open the page (the site returned HTTP ${res.status}).` },
        { status: 200 }
      );
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      return Response.json(
        { ok: false, note: `That link isn’t a readable web page (it’s ${ct || 'an unknown type'}).` },
        { status: 200 }
      );
    }
    const buf = await res.arrayBuffer();
    html = new TextDecoder().decode(
      buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf
    );
  } catch {
    return Response.json(
      { ok: false, note: 'I couldn’t reach that page (it timed out or refused the connection).' },
      { status: 200 }
    );
  }

  const title = extractTitle(html) || (typeof name === 'string' && name.trim()) || target.hostname;
  const text = htmlToText(html);

  // Illegible / gated: a real article yields plenty of text; a paywall teaser,
  // login wall, or JS-only page yields almost none.
  if (text.length < MIN_TEXT) {
    return Response.json(
      {
        ok: false,
        title,
        note:
          'I couldn’t pull readable text from that page — it’s likely paywalled, login-gated, or rendered entirely in JavaScript. You can paste the text in as a Text source instead.'
      },
      { status: 200 }
    );
  }

  // Keep the origin with the content so every snippet can cite + link back.
  const indexedText = `${title}\nSource: ${target.toString()}\n\n${text}`;

  try {
    const result = await indexText({
      sourceId: source_id,
      name: title,
      type: 'website',
      text: indexedText,
      namespace: nsForUser(userId)
    });
    return Response.json({ ok: true, chunks: result.chunks, title });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'index failed';
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
