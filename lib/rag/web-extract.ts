import 'server-only';
import { captureWebsiteText } from '@/lib/rag/cloudconvert';

// Fetch-only readable-page extraction for the OPINE artifact (right plug). Same
// guardrails as /api/index-website (robots.txt, SSRF guard, paywall/JS-only
// detection, deterministic htmlToText) — but it NEVER indexes: the artifact is
// carried whole and must stay out of Pinecone. Also pulls the page's hero image
// (og:image) for a visual preview on the artifact card.

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

/** The page's hero/preview image — what the site designates for social cards.
 *  Tries og:image (+secure_url), twitter:image, <link rel=image_src>, then the
 *  first reasonably-sized <img>. Resolved to an absolute URL against the page. */
function extractImage(html: string, base: URL): string | undefined {
  const metas = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i
  ];
  for (const re of metas) {
    const m = html.match(re);
    if (m?.[1]) {
      try {
        return new URL(decodeEntities(m[1]).trim(), base).toString();
      } catch {
        /* skip bad url */
      }
    }
  }
  // Fallback: first <img> with an http(s) src (skip tiny tracking pixels/data uris).
  const imgs = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
  for (const m of imgs) {
    const src = m[1];
    if (/^data:/.test(src)) continue;
    try {
      const abs = new URL(decodeEntities(src).trim(), base).toString();
      if (/^https?:/.test(abs)) return abs;
    } catch {
      /* skip */
    }
  }
  return undefined;
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
    if (!res.ok) return true;
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
    return true;
  }
}

export interface FetchedPage {
  ok: boolean;
  title?: string;
  text?: string;
  /** Hero/social image URL (og:image), absolute — instant fallback preview while
   *  the pixel-accurate CloudConvert screenshot renders. */
  image?: string;
  url?: string;
  /** Soft-failure explanation for the user (robots/paywall/illegible). */
  note?: string;
}

/** Fetch a public page and return its readable text + hero image. NEVER indexes.
 *  Soft failures return { ok:false, note } so the UI can explain them. */
export async function fetchReadablePage(url: string, name?: string): Promise<FetchedPage> {
  let target: URL;
  try {
    target = new URL(String(url));
  } catch {
    return { ok: false, note: 'That doesn’t look like a valid URL.' };
  }
  if (!/^https?:$/.test(target.protocol)) {
    return { ok: false, note: 'Only http(s) links can be read.' };
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
    return { ok: false, note: 'That host isn’t publicly reachable.' };
  }
  if (!(await robotsAllows(target))) {
    return {
      ok: false,
      note:
        'This site’s robots.txt asks automated readers not to fetch that page. Try a page the site allows, or paste the text in yourself.'
    };
  }

  let html = '';
  try {
    const res = await fetch(target.toString(), {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    });
    if (res.status === 401 || res.status === 403 || res.status === 451) {
      return {
        ok: false,
        note:
          'This page looks private or paywalled — I can only read publicly accessible pages, and I won’t bypass a login or paywall.'
      };
    }
    if (!res.ok) {
      return { ok: false, note: `Couldn’t open the page (the site returned HTTP ${res.status}).` };
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      return { ok: false, note: `That link isn’t a readable web page (it’s ${ct || 'an unknown type'}).` };
    }
    const buf = await res.arrayBuffer();
    html = new TextDecoder().decode(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf);
  } catch {
    return { ok: false, note: 'I couldn’t reach that page (it timed out or refused the connection).' };
  }

  const title = extractTitle(html) || (typeof name === 'string' && name.trim()) || target.hostname;
  const image = extractImage(html, target);
  let text = htmlToText(html);

  // JS-only site → the plain HTML had little/no text. Recover it by rendering the
  // page in a headless browser (CloudConvert) and reading the rendered text.
  if (text.length < MIN_TEXT) {
    const rendered = await captureWebsiteText(target.toString());
    if (rendered && rendered.length >= MIN_TEXT) text = rendered;
  }

  if (text.length < MIN_TEXT) {
    return {
      ok: false,
      title,
      image,
      note:
        'I couldn’t pull readable text from that page — it’s likely paywalled, login-gated, or rendered entirely in JavaScript. You can paste the text in instead.'
    };
  }

  return { ok: true, title, text, image, url: target.toString() };
}
