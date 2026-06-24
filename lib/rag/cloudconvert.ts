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
