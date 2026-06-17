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
export const maxDuration = 120;

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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;#39;|&#39;/g, "'")
    .replace(/&amp;quot;|&quot;/g, '"')
    .replace(/&amp;amp;|&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
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

  // Fetch captions — prefer English, fall back to the video's default track.
  let transcript = '';
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    let segs;
    try {
      segs = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    } catch {
      segs = await YoutubeTranscript.fetchTranscript(videoId);
    }
    transcript = decodeEntities(
      segs.map((s: { text: string }) => s.text).join(' ')
    )
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return Response.json({
      ok: false,
      indexed: false,
      source_url: url,
      note: 'No transcript/captions available for this video (or YouTube blocked the fetch). A Gemini video-transcription fallback is planned.'
    });
  }

  if (transcript.length < 20) {
    return Response.json({
      ok: false,
      indexed: false,
      source_url: url,
      note: 'The transcript came back empty.'
    });
  }

  try {
    const r = await indexText({ sourceId, name, type: 'youtube', text: transcript });
    return Response.json({
      ok: true,
      indexed: true,
      source_url: url,
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
