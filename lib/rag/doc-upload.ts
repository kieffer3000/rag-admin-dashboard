// SHARED document-index path (client). Extracted from board-canvas so EVERY
// uploader takes the identical, big-file-safe route:
//
//   binary docs (pdf/epub/docx/doc/rtf/odt) → /api/doc-job (presigned) →
//   browser uploads the RAW file STRAIGHT to CloudConvert (no Vercel ~4.5MB
//   body cap) → /api/index-doc {cc_job_id} polls + indexes the extracted text.
//
//   tiny text files (and small binaries when the CC hop fails client-side,
//   e.g. AV/VPN blocking third-party domains) → direct multipart POST.
//
// HISTORY (2026-07-04): the Library's Upload dialog skipped the CC hop and
// always POSTed raw multipart — so any book over ~4.5MB failed the platform
// cap 100% of the time ("why does this 529-page PDF keep failing?"). The cap
// is BYTES, never pages.

import { extractPdfLocally, segmentText } from '@/lib/rag/pdf-local';

const BINARY = /\.(pdf|epub|docx|doc|rtf|odt)$/i;
/** Retry-through-direct-route ceiling — Vercel's request-body cap is ~4.5MB. */
const DIRECT_MAX = 4 * 1024 * 1024;
/** Absolute document ceiling (client + declared to /api/doc-job). The presign
 *  hop has no platform cap, so WE must draw the line — nobody needs a 100GB
 *  "PDF", and conversion minutes cost real money. 100MB ≈ several full
 *  textbooks with images. */
export const MAX_DOC_BYTES = 100 * 1024 * 1024;

function sizeError(file: File): Error {
  return new Error(
    `File is ${(file.size / 1048576).toFixed(0)} MB — the maximum for a document is ${MAX_DOC_BYTES / 1048576} MB. Split it and upload the parts.`
  );
}

/** Presign + browser→CloudConvert upload. Returns the jobId, or null when the
 *  broker is unavailable (caller may fall back to the direct route).
 *  RETRIES transient broker failures (a 164-file import can rate-limit the
 *  converter's job-creation API; one 5xx must not doom a whole book). */
async function uploadViaConverter(file: File, ocr?: boolean): Promise<string | null> {
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();
  let jr: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      jr = await fetch('/api/doc-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext, ocr: !!ocr, sizeBytes: file.size })
      });
      if (jr.ok || jr.status === 413 || jr.status === 401) break;
    } catch {
      jr = null;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 500));
  }
  if (!jr || !jr.ok) {
    // 413 = the broker itself refused the declared size — a real error, not
    // an availability fallback.
    if (jr?.status === 413) {
      const j = await jr.json().catch(() => ({}));
      throw new Error(j?.error ?? 'File is over the upload size limit.');
    }
    return null;
  }
  const { jobId, upload: form } = await jr.json();
  const ccForm = new FormData();
  for (const [k, v] of Object.entries(form?.parameters ?? {}))
    ccForm.append(k, v as string);
  ccForm.append('file', file);
  const ur = await fetch(form.url, { method: 'POST', body: ccForm });
  if (!ur.ok && ur.status !== 201)
    throw new Error('Upload to the file converter failed.');
  return jobId as string;
}

export interface DocIndexResult {
  chunks?: number;
  source?: string;
}

// ---- Refresh guard -------------------------------------------------------
// A queued import batch lives on in-memory File handles: a refresh/close
// kills every file still waiting, with no retry (there is no server copy
// yet). While ANY document upload is in flight, arm beforeunload so the
// browser challenges navigation — deterministic code, not a hint the user
// can miss. (The dialogs also say it in words; this is the enforcement.)
let inFlightUploads = 0;
const warnUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = '';
};
function uploadStarted() {
  if (typeof window === 'undefined') return;
  if (++inFlightUploads === 1) window.addEventListener('beforeunload', warnUnload);
}
function uploadEnded() {
  if (typeof window === 'undefined') return;
  if (--inFlightUploads === 0) window.removeEventListener('beforeunload', warnUnload);
}

/** Index one document file end-to-end. Throws with a human message on failure. */
export async function indexDocumentFile(job: {
  id: string;
  name: string;
  file: File;
  ocr?: boolean;
}): Promise<DocIndexResult> {
  uploadStarted();
  try {
    return await indexDocumentFileInner(job);
  } finally {
    uploadEnded();
  }
}

async function indexDocumentFileInner({
  id,
  name,
  file,
  ocr
}: {
  id: string;
  name: string;
  file: File;
  ocr?: boolean;
}): Promise<DocIndexResult> {
  if (file.size > MAX_DOC_BYTES) throw sizeError(file);

  // LOCAL-FIRST PDFs (2026-07-06): read the text layer IN THE BROWSER
  // (pdf.js) — no converter, no 300s wall, no per-page conversion minutes.
  // A 1,770-page encyclopedia extracts in seconds and indexes in ~1.5M-char
  // segments that all share THIS source_id — ONE book in Pinecone and one
  // Library row (query filters match source_id; part-scoped chunk ids keep
  // the `sourceId#` delete-prefix intact). Scans (no text layer)
  // and any pdf.js hiccup fall through to the converter/OCR path unchanged;
  // a user-forced OCR upload skips local reading entirely.
  if (/\.pdf$/i.test(file.name) && !ocr) {
    const local = await extractPdfLocally(file);
    if (local) {
      const segs = segmentText(local.text);
      let chunks = 0;
      for (let s = 0; s < segs.length; s++) {
        const r = await fetch('/api/index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: id,
            name,
            type: 'document',
            text: segs[s],
            part_index: s + 1,
            part_total: segs.length
          })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok)
          throw new Error(
            j?.error ?? `index failed (part ${s + 1} of ${segs.length})`
          );
        chunks += j.chunks ?? 0;
      }
      return { chunks };
    }
  }

  if (BINARY.test(file.name)) {
    try {
      const jobId = await uploadViaConverter(file, ocr);
      if (jobId) {
        // RESUME LOOP (2026-07-04): a big book's conversion outlives one
        // request's ~260s poll window. The server then answers converting:true
        // and we RE-ATTACH to the SAME CloudConvert job — the next request
        // usually finds the finished text instantly. Re-minting a new job on
        // retry was the "Text extraction failed or timed out, every retry"
        // loop: each attempt re-billed the conversion and re-timed-out.
        // 5 windows ≈ 20+ min — covers the 10-minute encyclopedias.
        for (let attempt = 0; ; attempt++) {
          const ir = await fetch('/api/index-doc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: id, name, cc_job_id: jobId })
          });
          const ij = await ir.json().catch(() => ({}));
          if (ij?.converting && attempt < 4) {
            await new Promise((r) => setTimeout(r, 10_000));
            continue;
          }
          if (!ir.ok || !ij.ok)
            throw new Error(ij?.error ?? ij?.note ?? 'index failed');
          return { chunks: ij.chunks, source: ij.source_url };
        }
      }
      // doc-job unavailable (no converter configured) → fall through.
    } catch (ccErr) {
      // Small pdf/docx/epub may retry via the same-origin direct route; big
      // files can't fit the body cap and legacy formats need the converter —
      // those surface the real error.
      if (file.size > DIRECT_MAX || !/\.(pdf|docx|epub)$/i.test(file.name))
        throw ccErr;
      console.warn(
        '[doc-upload] converter hop failed, retrying via direct route:',
        ccErr
      );
    }
  }

  if (file.size > DIRECT_MAX) {
    // Big file whose converter hop came up empty. For BINARY docs that means
    // the broker was busy/unavailable (NOT a size problem — the old message
    // blamed 'the ~4 MB limit' and confused a 164-file import); for a huge
    // non-binary file (e.g. .txt) the direct route genuinely can't carry it.
    throw new Error(
      BINARY.test(file.name)
        ? 'The large-file converter was busy or unavailable — press Retry in a moment.'
        : `File is ${(file.size / 1048576).toFixed(1)} MB — over the ~4 MB direct-upload limit.`
    );
  }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('name', name);
  fd.append('source_id', id);
  if (ocr) fd.append('ocr', 'true');
  const r = await fetch('/api/index-doc', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j?.error ?? j?.note ?? 'index failed');
  return { chunks: j.chunks, source: j.source_url };
}

/** Extract a file's TEXT without indexing (Drafts/artifacts). Same big-file
 *  rules as indexDocumentFile: big binaries ride the converter hop; small
 *  files use the direct multipart route. Throws with a human message. */
export async function extractFileText({
  file,
  ocr
}: {
  file: File;
  ocr?: boolean;
}): Promise<string> {
  if (file.size > MAX_DOC_BYTES) throw sizeError(file);

  if (BINARY.test(file.name) && file.size > DIRECT_MAX) {
    const jobId = await uploadViaConverter(file, ocr);
    if (!jobId)
      throw new Error(
        'This file is over the ~4 MB direct-upload limit and the large-file converter is unavailable.'
      );
    const r = await fetch('/api/extract-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cc_job_id: jobId })
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok || !j.text)
      throw new Error(j?.note ?? j?.error ?? 'could not read this file.');
    return j.text as string;
  }

  if (file.size > DIRECT_MAX)
    throw new Error(
      `File is ${(file.size / 1048576).toFixed(1)} MB — over the ~4 MB direct-upload limit.`
    );
  const fd = new FormData();
  fd.append('file', file);
  if (ocr) fd.append('ocr', 'true');
  const r = await fetch('/api/extract-file', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j?.note ?? 'could not read this file.');
  return (j.text ?? '') as string;
}
