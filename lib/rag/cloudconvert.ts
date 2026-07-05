// Robust PDF → text via CloudConvert — the "no-fail" path (ported from the old
// AnswersDoc pipeline). Recipe: import/upload → optimize (engine 3heights,
// profile max — REPAIRS corrupt/malformed PDFs) → convert pdf→rtf → convert
// rtf→txt (the RTF intermediate yields cleaner text than pdf→txt direct) →
// export/url. Survives ugly/corrupt files that pdf.js (unpdf) chokes on.
//
// Synchronous: create job → upload the bytes to the presigned form → poll →
// download the .txt. Returns '' if not configured or on any failure, so the
// caller can fall back to unpdf — never throws.

const API = 'https://api.cloudconvert.com';
const POLL_MS = 2000;
const MAX_POLLS = Number(process.env.CLOUDCONVERT_MAX_POLLS ?? 90); // ~180s ceiling

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function extractPdfViaCloudConvert(
  bytes: Uint8Array | Buffer,
  filename = 'input.pdf',
  opts: { ocr?: boolean } = {}
): Promise<string> {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) return '';
  const auth = { Authorization: `Bearer ${key}` };
  try {
    // 1) create the job. Both paths repair first (optimize/3heights).
    //  - default: pdf→rtf→txt (fast, clean text from text-layer PDFs)
    //  - OCR:     pdf→docx (images_ocr: true, runs OCR on scanned images) →txt
    //    (costs more CloudConvert time; only for scanned/image PDFs)
    const optimize = {
      operation: 'optimize',
      input: 'import-1',
      engine: '3heights',
      profile: 'max'
    };
    const tasks = opts.ocr
      ? {
          'import-1': { operation: 'import/upload' },
          'optimize-1': optimize,
          'docx-1': {
            operation: 'convert',
            input: 'optimize-1',
            output_format: 'docx',
            engine: 'pdftron-pdf2word',
            images_ocr: true
          },
          'txt-1': { operation: 'convert', input: 'docx-1', output_format: 'txt' },
          'export-1': { operation: 'export/url', input: 'txt-1' }
        }
      : {
          'import-1': { operation: 'import/upload' },
          'optimize-1': optimize,
          'rtf-1': { operation: 'convert', input: 'optimize-1', output_format: 'rtf' },
          'txt-1': { operation: 'convert', input: 'rtf-1', output_format: 'txt' },
          'export-1': { operation: 'export/url', input: 'txt-1' }
        };
    const cr = await fetch(`${API}/v2/jobs`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks })
    });
    if (!cr.ok) return '';
    const job = (await cr.json()).data;
    const form = job?.tasks?.find((t: any) => t.operation === 'import/upload')?.result
      ?.form;
    if (!form?.url) return '';

    // 2) upload the bytes to the presigned upload form
    const fd = new FormData();
    for (const [k, v] of Object.entries(form.parameters ?? {})) fd.append(k, v as string);
    fd.append('file', new Blob([bytes as Uint8Array]), filename);
    const ur = await fetch(form.url, { method: 'POST', body: fd });
    if (!ur.ok && ur.status !== 201) return '';

    // 3) poll the job to completion
    let data: any = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_MS);
      const pr = await fetch(`${API}/v2/jobs/${job.id}`, { headers: auth });
      if (!pr.ok) continue;
      data = (await pr.json()).data;
      if (data.status === 'finished' || data.status === 'error') break;
    }
    if (!data || data.status !== 'finished') return '';

    // 4) download the resulting .txt
    const url = data.tasks?.find(
      (t: any) => t.operation === 'export/url' && t.status === 'finished'
    )?.result?.files?.[0]?.url;
    if (!url) return '';
    const tr = await fetch(url);
    if (!tr.ok) return '';
    return (await tr.text()).trim();
  } catch {
    return '';
  }
}

// ---- Website screenshot (for the Opine artifact preview) --------------------
// Pixel-accurate rendered screenshot via CloudConvert's capture-website op
// (Puppeteer). Returns a TEMPORARY export URL (the caller should persist it,
// e.g. to Blob, since CloudConvert URLs expire). '' on failure / unconfigured.

export async function captureWebsiteScreenshot(
  url: string,
  opts: { width?: number; height?: number } = {}
): Promise<string> {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) return '';
  const auth = { Authorization: `Bearer ${key}` };
  try {
    const tasks = {
      'shot-1': {
        operation: 'capture-website',
        url,
        output_format: 'png',
        screen_width: opts.width ?? 1280,
        screen_height: opts.height ?? 800,
        wait_until: 'networkidle0'
      },
      'export-1': { operation: 'export/url', input: 'shot-1' }
    };
    const cr = await fetch(`${API}/v2/jobs`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks })
    });
    if (!cr.ok) return '';
    const job = (await cr.json()).data;
    let data: any = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_MS);
      const pr = await fetch(`${API}/v2/jobs/${job.id}`, { headers: auth });
      if (!pr.ok) continue;
      data = (await pr.json()).data;
      if (data.status === 'finished' || data.status === 'error') break;
    }
    if (!data || data.status !== 'finished') return '';
    return (
      data.tasks?.find(
        (t: any) => t.operation === 'export/url' && t.status === 'finished'
      )?.result?.files?.[0]?.url ?? ''
    );
  } catch {
    return '';
  }
}

/** Rendered TEXT of a page via CloudConvert (capture-website → pdf → txt) —
 *  Puppeteer runs the page's JS, so this recovers text from client-rendered
 *  (JS-only) sites where a plain HTML fetch sees nothing. '' on failure. */
export async function captureWebsiteText(url: string): Promise<string> {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) return '';
  const auth = { Authorization: `Bearer ${key}` };
  try {
    const tasks = {
      'shot-1': {
        operation: 'capture-website',
        url,
        output_format: 'pdf',
        screen_width: 1280,
        wait_until: 'networkidle0'
      },
      'txt-1': { operation: 'convert', input: 'shot-1', output_format: 'txt' },
      'export-1': { operation: 'export/url', input: 'txt-1' }
    };
    const cr = await fetch(`${API}/v2/jobs`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks })
    });
    if (!cr.ok) return '';
    const job = (await cr.json()).data;
    let data: any = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_MS);
      const pr = await fetch(`${API}/v2/jobs/${job.id}`, { headers: auth });
      if (!pr.ok) continue;
      data = (await pr.json()).data;
      if (data.status === 'finished' || data.status === 'error') break;
    }
    if (!data || data.status !== 'finished') return '';
    const fileUrl = data.tasks?.find(
      (t: any) => t.operation === 'export/url' && t.status === 'finished'
    )?.result?.files?.[0]?.url;
    if (!fileUrl) return '';
    const tr = await fetch(fileUrl);
    if (!tr.ok) return '';
    return (await tr.text()).trim();
  } catch {
    return '';
  }
}

// ---- Audio compression + chunking (for long-audio transcription) ------------
// Long audio can't be POSTed through a Vercel function (~4.5 MB body cap). So the
// CLIENT uploads the raw file straight to CloudConvert (presigned form, no cap),
// CloudConvert compresses it to small low-bitrate AAC, and the transcribe route
// fetches that SERVER-side → OpenAI Whisper. Whisper has a HARD 25MB upload cap
// (and a 2h+ single file is unreliable — it 500s), so long audio is SPLIT here
// into 15-min segments (trim_start/trim_end) that the transcribe route stitches
// back. Two non-negotiable guards: stay under 25MB per file, and chunk long ones.

const AUDIO_BITRATE = Number(process.env.AUDIO_COMPRESS_BITRATE ?? 16); // kbps fallback

// We output AAC (.m4a), NOT mp3: mp3 has a hard low-bitrate FLOOR (~32kbps at a
// 48kHz source — CloudConvert ignored the sample-rate downshift, so a 2h file
// stayed ~28MB and tripped Whisper's 25MB cap no matter the requested bitrate).
// AAC has no such floor — it honours 8–32kbps directly at any sample rate — and
// Whisper natively accepts m4a. So low bitrates actually take effect now.
const VALID_BITRATES = [8, 16, 24, 32, 40, 48, 56, 64];
function snapBitrate(kbps: number): number {
  const n = Number.isFinite(kbps) ? kbps : AUDIO_BITRATE;
  let chosen = VALID_BITRATES[0];
  for (const b of VALID_BITRATES) if (b <= n) chosen = b;
  return Math.max(8, Math.min(64, chosen));
}

/** Highest bitrate that keeps `durationSec` of audio under ~20MB (margin below
 *  Whisper's 25MB). Short clips → high quality; long ones → compressed more, all
 *  automatic. ~9h fits at the 8kbps floor. */
export function bitrateForDuration(durationSec: number): number {
  if (!durationSec || durationSec <= 0) return AUDIO_BITRATE; // unknown → safe default
  const TARGET_BYTES = 20 * 1024 * 1024;
  const maxKbps = (TARGET_BYTES * 8) / durationSec / 1000;
  return snapBitrate(maxKbps);
}

// ---- Long-audio CHUNKING ----------------------------------------------------
// A 2h+ file in ONE Whisper call is unreliable (OpenAI 500s / our 25MB cap /
// undici timeout). So for long audio we ask CloudConvert to emit N TIME segments
// (ffmpeg `trim_start`/`trim_end`, verified option names) in a single job; the
// transcribe route then transcribes each segment and stitches them back with a
// per-chunk timestamp offset. Short audio stays a single file (1 Whisper call).
export const AUDIO_CHUNK_SEC = 900; // 15 min/segment — Whisper handles this comfortably
const CHUNK_THRESHOLD_SEC = 1500; // ≤25 min → single file; longer → chunk
const CHUNK_BITRATE = 48; // per-segment size isn't the constraint → favour accuracy
const MAX_CHUNKS = 48; // ~12h ceiling (beyond this, ask the user to split)

/** HH:MM:SS for CloudConvert's trim_start/trim_end. */
function secToHMS(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** How many segments a given duration is split into (1 = no chunking). */
export function audioChunkCount(durationSec: number): number {
  if (!durationSec || durationSec <= CHUNK_THRESHOLD_SEC) return 1;
  return Math.min(MAX_CHUNKS, Math.ceil(durationSec / AUDIO_CHUNK_SEC));
}

/** Create a CloudConvert job that transcodes an uploaded audio file → small AAC
 *  (.m4a), as a SINGLE file (short audio) or N trimmed 15-min segments (long).
 *  Returns the jobId + presigned upload form for the client to PUT, plus the
 *  chunk count. */
export async function createAudioTranscodeJob(
  durationSec: number,
  bitrateKbps?: number
): Promise<
  | { jobId: string; form: { url: string; parameters: Record<string, string> }; chunks: number }
  | null
> {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) return null;
  const n = audioChunkCount(durationSec);
  try {
    const tasks: Record<string, unknown> = { 'import-1': { operation: 'import/upload' } };
    if (n <= 1) {
      tasks['audio-001'] = {
        operation: 'convert',
        input: 'import-1',
        output_format: 'm4a',
        audio_codec: 'aac',
        audio_bitrate: snapBitrate(bitrateKbps ?? bitrateForDuration(durationSec)),
        channels: 1 // mono — all Whisper needs (correct option is `channels`, not audio_channels)
      };
      tasks['export-001'] = { operation: 'export/url', input: 'audio-001' };
    } else {
      const audio_bitrate = snapBitrate(CHUNK_BITRATE);
      for (let i = 0; i < n; i++) {
        const id = String(i + 1).padStart(3, '0');
        const conv: Record<string, unknown> = {
          operation: 'convert',
          input: 'import-1',
          output_format: 'm4a',
          audio_codec: 'aac',
          audio_bitrate,
          channels: 1,
          trim_start: secToHMS(i * AUDIO_CHUNK_SEC)
        };
        // Last segment runs to the end (omit trim_end → no rounding cutoff).
        if (i < n - 1) conv.trim_end = secToHMS((i + 1) * AUDIO_CHUNK_SEC);
        tasks[`audio-${id}`] = conv;
        tasks[`export-${id}`] = { operation: 'export/url', input: `audio-${id}` };
      }
    }
    const r = await fetch(`${API}/v2/jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks })
    });
    if (!r.ok) return null;
    const job = (await r.json()).data;
    const form = job?.tasks?.find((t: any) => t.operation === 'import/upload')?.result
      ?.form;
    if (!form?.url) return null;
    return { jobId: job.id, form, chunks: n };
  } catch {
    return null;
  }
}

/** Poll a CloudConvert audio job → the ORDERED list of output file URLs (one for
 *  a single file, N for a chunked job, ordered by segment index). [] on failure.
 *  A bigger poll ceiling than the PDF path — many segments take longer. */
export async function pollAudioOutputUrls(jobId: string): Promise<string[]> {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) return [];
  const auth = { Authorization: `Bearer ${key}` };
  const max = Number(process.env.CLOUDCONVERT_AUDIO_MAX_POLLS ?? 150); // ~300s
  for (let i = 0; i < max; i++) {
    await sleep(POLL_MS);
    try {
      const pr = await fetch(`${API}/v2/jobs/${jobId}`, { headers: auth });
      if (!pr.ok) continue;
      const data = (await pr.json()).data;
      if (data.status === 'error') return [];
      if (data.status === 'finished') {
        return ((data.tasks ?? []) as any[])
          .filter((t) => t.operation === 'export/url' && t.status === 'finished')
          .sort((a, b) => String(a.name).localeCompare(String(b.name))) // export-001, -002, …
          .map((t) => t?.result?.files?.[0]?.url as string)
          .filter(Boolean);
      }
    } catch {
      /* keep polling */
    }
  }
  return [];
}

// ---- Document extraction (bypass the ~4.5MB Vercel body cap) -----------------
// A book PDF/EPUB is far bigger than a Vercel function can accept as a POST body.
// So — exactly like audio — the CLIENT uploads the RAW file straight to
// CloudConvert (presigned form, no cap); CloudConvert optimizes/repairs (PDF via
// 3heights) and converts to plain TEXT; then /api/index-doc polls this job,
// fetches the SMALL text, and runs the same chunk→embed→Pinecone pipeline. No
// Make changes — it's the identical text path, just fed a different way.

/** Create a CloudConvert job: uploaded document (PDF/EPUB/DOCX/…) → plain TEXT.
 *  Returns the jobId + presigned upload form for the client to POST the raw file
 *  to (no size cap). null when CloudConvert isn't configured. */
export async function createDocExtractJob(
  ext: string,
  opts: { ocr?: boolean; sizeBytes?: number } = {}
): Promise<{ jobId: string; form: { url: string; parameters: Record<string, string> } } | null> {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) return null;
  const e = (ext || '').toLowerCase().replace(/^\./, '');
  // BIG-PDF bypass (2026-07-04): the optimize→rtf→txt chain builds the whole
  // document in memory — a 94MB scanned book got the converter OOM-KILLED
  // (signal 9) on every attempt, an unretryable failure loop. Direct pdf→txt
  // streams page-by-page and copes with huge files; if the giant is a pure
  // scan (no text layer) extraction returns ~nothing and the route already
  // says plainly to re-upload with OCR — honest, instead of a silent kill.
  const HUGE_PDF_BYTES = 25 * 1024 * 1024;
  const hugePdf = e === 'pdf' && !opts.ocr && (opts.sizeBytes ?? 0) > HUGE_PDF_BYTES;
  try {
    let tasks: Record<string, unknown>;
    if (hugePdf) {
      tasks = {
        'import-1': { operation: 'import/upload' },
        'txt-1': { operation: 'convert', input: 'import-1', output_format: 'txt' },
        'export-1': { operation: 'export/url', input: 'txt-1' }
      };
    } else if (e === 'pdf') {
      const optimize = { operation: 'optimize', input: 'import-1', engine: '3heights', profile: 'max' };
      tasks = opts.ocr
        ? {
            'import-1': { operation: 'import/upload' },
            'optimize-1': optimize,
            'docx-1': {
              operation: 'convert',
              input: 'optimize-1',
              output_format: 'docx',
              engine: 'pdftron-pdf2word',
              images_ocr: true
            },
            'txt-1': { operation: 'convert', input: 'docx-1', output_format: 'txt' },
            'export-1': { operation: 'export/url', input: 'txt-1' }
          }
        : {
            'import-1': { operation: 'import/upload' },
            'optimize-1': optimize,
            'rtf-1': { operation: 'convert', input: 'optimize-1', output_format: 'rtf' },
            'txt-1': { operation: 'convert', input: 'rtf-1', output_format: 'txt' },
            'export-1': { operation: 'export/url', input: 'txt-1' }
          };
    } else {
      // epub, docx, doc, rtf, odt, … → txt directly (CloudConvert handles each).
      tasks = {
        'import-1': { operation: 'import/upload' },
        'txt-1': { operation: 'convert', input: 'import-1', output_format: 'txt' },
        'export-1': { operation: 'export/url', input: 'txt-1' }
      };
    }
    const r = await fetch(`${API}/v2/jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks })
    });
    if (!r.ok) return null;
    const job = (await r.json()).data;
    const form = job?.tasks?.find((t: any) => t.operation === 'import/upload')?.result?.form;
    if (!form?.url) return null;
    return { jobId: job.id, form };
  } catch {
    return null;
  }
}

/** Poll a doc-extract job → the extracted .txt file URL (single). '' on failure. */
export async function pollDocTextUrl(jobId: string): Promise<string> {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) return '';
  const auth = { Authorization: `Bearer ${key}` };
  const max = Number(process.env.CLOUDCONVERT_DOC_MAX_POLLS ?? 130); // ~260s, under maxDuration
  for (let i = 0; i < max; i++) {
    await sleep(POLL_MS);
    try {
      const pr = await fetch(`${API}/v2/jobs/${jobId}`, { headers: auth });
      if (!pr.ok) continue;
      const data = (await pr.json()).data;
      if (data.status === 'error') return '';
      if (data.status === 'finished') {
        return (
          ((data.tasks ?? []) as any[]).find(
            (t) => t.operation === 'export/url' && t.status === 'finished'
          )?.result?.files?.[0]?.url ?? ''
        );
      }
    } catch {
      /* keep polling */
    }
  }
  return '';
}
