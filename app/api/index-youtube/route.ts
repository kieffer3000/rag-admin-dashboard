import { auth } from '@clerk/nextjs/server';
import { indexText } from '@/lib/rag/index-core';
import { nsForUser } from '@/lib/rag/namespace';

// YouTube ingestion. Captions are a deterministic data source (like a PDF's
// text layer), so we fetch the FULL transcript in-route — no LLM, no token
// limit — and run it through the SAME text pipeline (chunk → Gemini embedding
// in Make → Pinecone). No new Make scenario.
//
// Videos with no caption track at all → reported clearly (a Gemini
// video-transcription fallback is the future upgrade). YouTube may also block
// caption fetches from datacenter IPs; that surfaces as the same "no transcript"
// path rather than a crash.

export const runtime = 'nodejs';
export const maxDuration = 300;

// Fallback transcription via Make (MAKE_TRANSCRIBE_WEBHOOK_URL) — the app never
// calls a model directly. Posts the video URL; the Make scenario (Gemini reading
// the URL server-side, model managed in Make) returns the transcript. Returns ''
// when the webhook isn't configured → the caller's "no transcript" path.
async function transcribeViaMake(url: string): Promise<string> {
  const webhook = process.env.MAKE_TRANSCRIBE_WEBHOOK_URL;
  if (!webhook) return '';
  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!r.ok) return '';
    const raw = (await r.text()).trim();
    if (!raw || raw === 'Accepted') return '';
    try {
      const j = JSON.parse(raw);
      const t = j?.transcript ?? j?.text ?? j?.result ?? '';
      return typeof t === 'string' ? t.trim() : '';
    } catch {
      return raw; // plain-text transcript
    }
  } catch {
    return '';
  }
}

function parseVideoId(input: string): string | null {
  const url = input.trim();
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/live\/([\w-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  if (/^[\w-]{11}$/.test(url)) return url; // a bare id
  return null;
}

// oEmbed gives the real video title + thumbnail with NO API key. Fetched
// server-side (the endpoint doesn't send CORS headers, so a browser fetch
// would be blocked). Best-effort — failure just leaves the caller's name.
async function fetchOEmbed(
  url: string
): Promise<{ title?: string; thumbnail?: string }> {
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    if (!r.ok) return {};
    const j = await r.json();
    return {
      title: typeof j.title === 'string' ? j.title : undefined,
      thumbnail:
        typeof j.thumbnail_url === 'string' ? j.thumbnail_url : undefined
    };
  } catch {
    return {};
  }
}

function formatTs(totalSec: number): string {
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;#39;|&#39;/g, "'")
    .replace(/&amp;quot;|&quot;/g, '"')
    .replace(/&amp;amp;|&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Route the caption fetch through a RESIDENTIAL proxy so it isn't blocked like
// Vercel's datacenter IP. youtube-transcript accepts a custom fetch, so we bind
// undici to a ProxyAgent per-call (no global dispatcher leakage). Returns
// undefined when no proxy is set → the lib uses plain fetch (works locally,
// blocked on Vercel).
async function makeProxyFetch(): Promise<
  ((input: any, init?: any) => Promise<any>) | undefined
> {
  const proxyUrl = process.env.RESIDENTIAL_PROXY_URL;
  if (!proxyUrl) return undefined;
  const { ProxyAgent, fetch: undiciFetch } = await import('undici');
  const dispatcher = new ProxyAgent(proxyUrl);
  return (input: any, init: any = {}) =>
    undiciFetch(input, { ...init, dispatcher });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? '').trim();
  const sourceId = String(body.source_id ?? '').trim();
  const name = String(body.name ?? '').trim() || 'YouTube video';
  if (!url || !sourceId) {
    return Response.json({ error: 'url and source_id are required' }, { status: 400 });
  }

  const videoId = parseVideoId(url);
  if (!videoId) {
    return Response.json(
      { ok: false, error: 'Could not find a YouTube video id in that URL.' },
      { status: 400 }
    );
  }

  // Auto-title + thumbnail from oEmbed (no API key). Title becomes the chip
  // name; thumbnail falls back to the deterministic ytimg URL.
  const oembed = await fetchOEmbed(url);
  const title = oembed.title || name;
  const thumbnail =
    oembed.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  // 1) Try captions (verbatim, free, full-length). Prefer English.
  let transcript = '';
  let method = 'captions';
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const proxyFetch = await makeProxyFetch();
    const cfg: any = proxyFetch ? { fetch: proxyFetch } : {};
    let segs;
    try {
      segs = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en', ...cfg });
    } catch {
      segs = await YoutubeTranscript.fetchTranscript(videoId, cfg);
    }
    // Interleave a [M:SS] marker every ~15s so the indexed text carries time
    // anchors → answers can cite the moment (and deep-link to ?t=). Detect the
    // offset unit ONCE for the whole transcript (the lib uses ms; >10h in
    // seconds is implausible, so a large max ⇒ milliseconds).
    const list = segs as Array<{ text: string; offset: number }>;
    const maxOff = list.reduce((m, s) => Math.max(m, s.offset), 0);
    const isMs = maxOff > 36000;
    const parts: string[] = [];
    let lastMark = -999;
    for (const seg of list) {
      const sec = isMs ? seg.offset / 1000 : seg.offset;
      if (sec - lastMark >= 15) {
        parts.push(`[${formatTs(sec)}]`);
        lastMark = sec;
      }
      parts.push(decodeEntities(seg.text));
    }
    transcript = parts.join(' ').replace(/[ \t]+/g, ' ').trim();
  } catch {
    transcript = ''; // captions blocked/missing → fall through to Gemini
  }

  // 2) Optional fallback: Gemini transcribes the video (costs ~$0.06/17min).
  //    OFF by default so the proxy path can't silently fall into a paid call —
  //    enable with RAG_YT_GEMINI_FALLBACK=1.
  if (transcript.length < 20) {
    if (process.env.MAKE_TRANSCRIBE_WEBHOOK_URL) {
      method = 'make-transcribe';
      try {
        transcript = await transcribeViaMake(url);
      } catch (e: any) {
        return Response.json({
          ok: false,
          indexed: false,
          source_url: url,
          note: `Couldn't get a transcript (proxy captions failed and Gemini fallback failed: ${e?.message ?? 'error'}).`
        });
      }
    } else {
      return Response.json({
        ok: false,
        indexed: false,
        source_url: url,
        note: 'No captions via the residential proxy (proxy unset/blocked, or the video has no captions). Set RESIDENTIAL_PROXY_URL — or enable RAG_YT_GEMINI_FALLBACK=1 to transcribe with Gemini.'
      });
    }
  }

  if (transcript.length < 20) {
    return Response.json({
      ok: false,
      indexed: false,
      source_url: url,
      title,
      thumbnail,
      note: 'No transcript could be produced for this video.'
    });
  }

  try {
    const r = await indexText({
      sourceId,
      name: title,
      type: 'youtube',
      text: transcript,
      namespace: nsForUser(userId)
    });
    return Response.json({
      ok: true,
      indexed: true,
      source_url: url,
      title,
      thumbnail,
      method,
      chunks: r.chunks,
      chars: transcript.length
    });
  } catch (e: any) {
    const msg = e?.message ?? 'index failed';
    return Response.json(
      { ok: false, indexed: false, source_url: url, error: msg },
      { status: /not configured/.test(msg) ? 503 : 502 }
    );
  }
}
