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

const BINARY = /\.(pdf|epub|docx|doc|rtf|odt)$/i;
/** Retry-through-direct-route ceiling — Vercel's request-body cap is ~4.5MB. */
const DIRECT_MAX = 4 * 1024 * 1024;

export interface DocIndexResult {
  chunks?: number;
  source?: string;
}

/** Index one document file end-to-end. Throws with a human message on failure. */
export async function indexDocumentFile({
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
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

  if (BINARY.test(file.name)) {
    try {
      const jr = await fetch('/api/doc-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext, ocr: !!ocr })
      });
      if (jr.ok) {
        const { jobId, upload: form } = await jr.json();
        const ccForm = new FormData();
        for (const [k, v] of Object.entries(form?.parameters ?? {}))
          ccForm.append(k, v as string);
        ccForm.append('file', file);
        const ur = await fetch(form.url, { method: 'POST', body: ccForm });
        if (!ur.ok && ur.status !== 201)
          throw new Error('Upload to the file converter failed.');
        const ir = await fetch('/api/index-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_id: id, name, cc_job_id: jobId })
        });
        const ij = await ir.json().catch(() => ({}));
        if (!ir.ok || !ij.ok)
          throw new Error(ij?.error ?? ij?.note ?? 'index failed');
        return { chunks: ij.chunks, source: ij.source_url };
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
    // Non-binary big file (e.g. a huge .txt) — the direct route would be
    // rejected by the platform with an opaque 413; say it plainly instead.
    throw new Error(
      `File is ${(file.size / 1048576).toFixed(1)} MB — over the ~4 MB direct-upload limit.`
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
