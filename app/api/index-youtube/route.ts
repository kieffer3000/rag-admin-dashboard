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
                text: 'Transcribe the spoken content of this video as accurately and completely as possible, from start to finish. Output ONLY the transcript text — no timestamps, no speaker labels, no commentary.'
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32768,
          thinkingConfig: { thinkingBudget: 0 }
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

  // 1) Try captions (verbatim, free, full-length). Prefer English.
  let transcript = '';
  let method = 'captions';
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
    transcript = ''; // captions blocked/missing → fall through to Gemini
  }

  // 2) Fallback: Gemini transcribes the video (no datacenter-IP block).
  if (transcript.length < 20) {
    method = 'gemini';
    try {
      transcript = await geminiTranscribe(url);
    } catch (e: any) {
      return Response.json({
        ok: false,
        indexed: false,
        source_url: url,
        note: `Couldn't get a transcript (captions blocked and Gemini transcription failed: ${e?.message ?? 'error'}).`
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
