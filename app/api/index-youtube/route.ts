import { auth } from '@clerk/nextjs/server';
import { indexText } from '@/lib/rag/index-core';

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

// Fallback transcription: Gemini ingests the YouTube URL directly (Google
// fetches the video server-side, so it sidesteps YouTube's datacenter-IP block
// that defeats caption scraping from Vercel). Model id is an env var so it can
// be bumped without a code change. Thinking disabled so the whole output budget
// goes to the transcript. Very long videos may still hit the output-token cap.
async function geminiTranscribe(url: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');
  const model = process.env.RAG_YT_TRANSCRIBE_MODEL ?? 'gemini-2.5-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { fileData: { fileUri: url } },
              {
                text: 'Transcribe the spoken content of this video from start to finish, as accurately and completely as possible. Begin each paragraph (roughly every 15–30 seconds of speech, or at each clear topic shift) with its start time in [M:SS] format — use [H:MM:SS] once past one hour. Output ONLY the timestamped transcript — no speaker labels, no extra commentary.'
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32768,
          thinkingConfig: { thinkingBudget: 0 },
          // Transcription needs the AUDIO, not HD frames — low resolution cuts
          // the per-frame video tokens ~4x (258 → 66 tokens/frame) for the same
          // transcript. Biggest cost lever here.
          mediaResolution: 'MEDIA_RESOLUTION_LOW'
        }
      })
    }
  );
  const j = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(j?.error?.message ?? `Gemini returned ${res.status}`);
  const text: string = (j?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('')
    .trim();
  return text;
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
    if (process.env.RAG_YT_GEMINI_FALLBACK === '1') {
      method = 'gemini';
      try {
        transcript = await geminiTranscribe(url);
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
      note: 'No transcript could be produced for this video.'
    });
  }

  try {
    const r = await indexText({ sourceId, name, type: 'youtube', text: transcript });
    return Response.json({
      ok: true,
      indexed: true,
      source_url: url,
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
