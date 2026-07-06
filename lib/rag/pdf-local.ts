// LOCAL PDF READER (client) — "unpdf-first", in the browser.
//
// WHY: the converter path (CloudConvert) takes 7-9 MINUTES for a 1,770-page
// book and then collides with the serverless 300s wall ("index failed" on
// every encyclopedia). But most PDFs carry a real TEXT LAYER — the browser
// can read it in seconds with pdf.js, for free, with zero server time.
//
// This module scans a PDF locally (page count + text-layer probe) and
// extracts the full text. Scans (no text layer) return null fast so the
// caller falls back to the converter/OCR path. ANY pdf.js failure also
// returns null — local-first is an optimization, never a new failure mode.

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
      return m;
    });
  }
  return pdfjsPromise;
}

export interface LocalPdfText {
  pages: number;
  text: string;
}

/** Pages sniffed before committing to a full read. */
const PROBE_PAGES = 15;
/** Below this average the PDF is a scan (images) → OCR path instead. */
const MIN_CHARS_PER_PAGE = 150;

/**
 * Scan + extract a PDF's text layer in the browser.
 * Returns null when the PDF is a scan, is text-poor, or pdf.js fails —
 * the caller then takes the existing converter path unchanged.
 */
export async function extractPdfLocally(
  file: File,
  onProgress?: (page: number, pages: number) => void
): Promise<LocalPdfText | null> {
  try {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const doc = await task.promise;
    const pages = doc.numPages;
    const parts: string[] = [];
    let chars = 0;
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const line = tc.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      parts.push(line);
      chars += line.length;
      // Early verdict: after the probe window a text-less PDF is a SCAN —
      // bail fast instead of chewing 1,770 pages to learn nothing.
      if (p === Math.min(PROBE_PAGES, pages) && chars / p < MIN_CHARS_PER_PAGE) {
        void task.destroy();
        return null;
      }
      onProgress?.(p, pages);
    }
    void task.destroy();
    const text = parts.join('\n\n');
    if (text.trim().length < 500) return null;
    return { pages, text };
  } catch {
    return null;
  }
}

/**
 * Split extracted text into index-safe SEGMENTS. Each segment travels as one
 * JSON POST to /api/index (platform body cap ~4.5MB; 1.5M chars keeps a wide
 * safety margin incl. JSON escaping) and indexes comfortably inside the
 * route's time budget. Splits on paragraph boundaries; a pathological single
 * paragraph is hard-sliced.
 */
export function segmentText(text: string, maxChars = 1_500_000): string[] {
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  let cur = '';
  for (const para of text.split('\n\n')) {
    if (para.length > maxChars) {
      // hard-slice an oversized paragraph
      if (cur) {
        out.push(cur);
        cur = '';
      }
      for (let i = 0; i < para.length; i += maxChars)
        out.push(para.slice(i, i + maxChars));
      continue;
    }
    if (cur.length + para.length + 2 > maxChars) {
      out.push(cur);
      cur = para;
    } else {
      cur = cur ? `${cur}\n\n${para}` : para;
    }
  }
  if (cur) out.push(cur);
  return out;
}
