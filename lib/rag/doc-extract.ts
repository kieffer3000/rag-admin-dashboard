import 'server-only';
import { extractPdfViaCloudConvert } from '@/lib/rag/cloudconvert';

// Deterministic document → text extraction (PDF / DOCX / EPUB / TXT|MD). Shared
// by /api/extract-file (Opine artifact — extract ONLY, never indexed) so an
// artifact can be a file too. The indexing path (/api/index-doc) keeps its own
// copy to avoid coupling the live ingestion route to this.

async function extractPdf(bytes: Uint8Array, ocr = false): Promise<string> {
  const cc = await extractPdfViaCloudConvert(bytes, 'input.pdf', { ocr });
  if (cc && cc.length >= 20) return cc;
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join('\n\n') : text;
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
  const { value } = await (mammoth as any).extractRawText({ buffer: buf });
  return value as string;
}

function stripXhtml(html: string): string {
  return html
    .replace(/<\s*(script|style)[\s\S]*?<\/\s*\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractEpub(buf: Buffer): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error('not a valid EPUB (no OPF)');
  const opf = (await zip.file(opfPath)?.async('string')) ?? '';
  const baseDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]*$/, '/') : '';
  const manifest: Record<string, string> = {};
  for (const m of opf.matchAll(/<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*>/gi))
    manifest[m[1]] = m[2];
  for (const m of opf.matchAll(/<item\s+[^>]*href="([^"]+)"[^>]*id="([^"]+)"[^>]*>/gi))
    if (!manifest[m[2]]) manifest[m[2]] = m[1];
  const spine = [...opf.matchAll(/<itemref\s+[^>]*idref="([^"]+)"/gi)].map((m) => m[1]);
  const out: string[] = [];
  for (const idref of spine) {
    const href = manifest[idref];
    if (!href) continue;
    const f = zip.file(decodeURIComponent(baseDir + href));
    if (!f) continue;
    const t = stripXhtml(await f.async('string'));
    if (t) out.push(t);
  }
  return out.join('\n\n');
}

export interface ExtractedDoc {
  ok: boolean;
  text?: string;
  note?: string;
}

/** Extract readable text from a document Blob. ocr=true routes scanned PDFs
 *  through CloudConvert OCR. Returns { ok:false, note } for unsupported / empty /
 *  scanned files so the caller can explain it. */
export async function extractDocumentText(
  file: Blob,
  filename: string,
  ocr = false
): Promise<ExtractedDoc> {
  const mime = file.type || '';
  const lowerName = (filename || '').toLowerCase();
  const isPdf = mime === 'application/pdf' || lowerName.endsWith('.pdf');
  const isDocx =
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx');
  const isEpub = mime === 'application/epub+zip' || lowerName.endsWith('.epub');
  const isTxt = mime.startsWith('text/') || lowerName.endsWith('.txt') || lowerName.endsWith('.md');
  if (!isPdf && !isDocx && !isEpub && !isTxt) {
    return { ok: false, note: `Unsupported file type ${mime || lowerName}. Use PDF, DOCX, EPUB, TXT, or MD.` };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let text = '';
  try {
    if (isPdf) text = await extractPdf(new Uint8Array(buf), ocr);
    else if (isDocx) text = await extractDocx(buf);
    else if (isEpub) text = await extractEpub(buf);
    else text = buf.toString('utf-8');
  } catch (e: any) {
    return { ok: false, note: `Could not read the document: ${e?.message ?? 'parse error'}` };
  }

  text = text.trim();
  if (text.length < 20) {
    return {
      ok: false,
      note: isPdf
        ? 'No selectable text found — this looks like a scanned/image PDF. Try the OCR option.'
        : 'The document had no extractable text.'
    };
  }
  return { ok: true, text };
}
