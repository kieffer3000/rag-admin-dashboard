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

// ---- Audio compression (for long-audio transcription) -----------------------
// Long audio can't be POSTed through a Vercel function (~4.5 MB body cap). So the
// CLIENT uploads the raw file straight to CloudConvert (presigned form, no cap),
// CloudConvert compresses it to a small low-bitrate MP3, and the transcribe route
// fetches that result SERVER-side → MAI (which accepts MP3, up to 300 MB).
// MAI bills by duration, not size, so this is purely to beat the size limit +
// shrink the server-side fetch — mirrors the old AnswersDoc m4a@25k trick.

// kbps. 12k MONO/16kHz keeps even a ~4.5h file under Whisper's 25MB cap (16k
// only reached ~3.4h, so a long recording still 413'd). Plenty for speech STT.
const AUDIO_BITRATE = Number(process.env.AUDIO_COMPRESS_BITRATE ?? 12);

/** Create a CloudConvert job that compresses an uploaded audio file → MP3.
 *  Returns the jobId + the presigned upload form for the client to PUT into. */
export async function createAudioCompressJob(): Promise<
  { jobId: string; form: { url: string; parameters: Record<string, string> } } | null
> {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) return null;
  try {
    const tasks = {
      'import-1': { operation: 'import/upload' },
      'mp3-1': {
        operation: 'convert',
        input: 'import-1',
        output_format: 'mp3',
        audio_bitrate: AUDIO_BITRATE,
        // Force MONO + 16kHz — Whisper works at 16kHz mono anyway, and without
        // this ffmpeg can't actually reach 16kbps on a stereo/full-rate source,
        // so the "compressed" file stayed huge and tripped Whisper's 25MB cap
        // (a 2h file came out ~26MB instead of ~14MB). Now it truly hits 16kbps.
        audio_channels: 1,
        audio_frequency: 16000
      },
      'export-1': { operation: 'export/url', input: 'mp3-1' }
    };
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
    return { jobId: job.id, form };
  } catch {
    return null;
  }
}

/** Poll a CloudConvert job to completion and return the compressed file URL
 *  (empty string on failure). */
export async function pollAudioCompressedUrl(jobId: string): Promise<string> {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) return '';
  const auth = { Authorization: `Bearer ${key}` };
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_MS);
    try {
      const pr = await fetch(`${API}/v2/jobs/${jobId}`, { headers: auth });
      if (!pr.ok) continue;
      const data = (await pr.json()).data;
      if (data.status === 'error') return '';
      if (data.status === 'finished')
        return (
          data.tasks?.find(
            (t: any) => t.operation === 'export/url' && t.status === 'finished'
          )?.result?.files?.[0]?.url ?? ''
        );
    } catch {
      /* keep polling */
    }
  }
  return '';
}
