import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { indexText } from '@/lib/rag/index-core';
import { nsForUser } from '@/lib/rag/namespace';
import { extractPdfViaCloudConvert } from '@/lib/rag/cloudconvert';

// Document ingestion (PDF / DOCX / TXT). Text extraction is deterministic
// parsing (NOT an LLM), done in-route, then handed to the SAME text pipeline
// (chunk → Gemini embedding in Make → Pinecone). So documents reuse the proven
// text path end-to-end; no new Make scenario. The original file is also stored
// on Blob so the source can be opened/cited.
//
// Scanned/image-only PDFs have no text layer → extraction returns ~nothing; we
// report that clearly (OCR via Gemii vision is a later upgrade).

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

async function extractPdf(bytes: Uint8Array): Promise<string> {
  // PRIMARY: CloudConvert "no-fail" path — repairs corrupt PDFs (3heights) and
  // extracts via pdf→rtf→txt. Survives files that pdf.js chokes on.
  const cc = await extractPdfViaCloudConvert(bytes);
  if (cc && cc.length >= 20) return cc;
  // FALLBACK: unpdf (pdf.js) when CloudConvert is unconfigured or returns nothing.
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

/** EPUB = a ZIP of XHTML. Read the OPF spine for reading order, strip each
 *  chapter's tags, concatenate. (A whole book → many chunks.) */
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

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  const name = String(form.get('name') ?? '').trim() || 'Document';
  const sourceId = String(form.get('source_id') ?? '').trim();
  if (!(file instanceof Blob) || !sourceId) {
    return Response.json({ error: 'file and source_id are required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `File is ${(file.size / 1048576).toFixed(1)} MB; max is 25 MB.` },
      { status: 413 }
    );
  }

  const mime = file.type || '';
  const lowerName = (file as File).name?.toLowerCase() ?? '';
  const isPdf = mime === 'application/pdf' || lowerName.endsWith('.pdf');
  const isDocx =
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx');
  const isEpub = mime === 'application/epub+zip' || lowerName.endsWith('.epub');
  const isTxt = mime.startsWith('text/') || lowerName.endsWith('.txt') || lowerName.endsWith('.md');
  if (!isPdf && !isDocx && !isEpub && !isTxt) {
    return Response.json(
      { error: `Unsupported document type ${mime || lowerName}. Use PDF, DOCX, EPUB, TXT, or MD.` },
      { status: 415 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // 1) Store the original so the source can be opened later (optional, cheap).
  let sourceUrl: string | undefined;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const ext = isPdf ? 'pdf' : isDocx ? 'docx' : isEpub ? 'epub' : 'txt';
    try {
      const blob = await put(`docs/${userId}/${sourceId}.${ext}`, buf, {
        access: 'public',
        addRandomSuffix: true
      });
      sourceUrl = blob.url;
    } catch {
      /* storage is best-effort; indexing the text is what matters */
    }
  }

  // 2) Extract text (deterministic).
  let text = '';
  try {
    if (isPdf) text = await extractPdf(new Uint8Array(buf));
    else if (isDocx) text = await extractDocx(buf);
    else if (isEpub) text = await extractEpub(buf);
    else text = buf.toString('utf-8');
  } catch (e: any) {
    return Response.json(
      { ok: false, error: `Could not read the document: ${e?.message ?? 'parse error'}`, source_url: sourceUrl },
      { status: 422 }
    );
  }

  text = text.trim();
  if (text.length < 20) {
    return Response.json({
      ok: false,
      indexed: false,
      source_url: sourceUrl,
      note: isPdf
        ? 'No selectable text found — this looks like a scanned/image PDF. OCR is coming soon.'
        : 'The document had no extractable text.'
    });
  }

  // 3) Reuse the text pipeline: chunk → Make embedding → Pinecone.
  try {
    const r = await indexText({
      sourceId,
      name,
      type: 'document',
      text,
      namespace: nsForUser(userId)
    });
    return Response.json({
      ok: true,
      indexed: true,
      source_url: sourceUrl,
      chunks: r.chunks,
      failed_chunks: r.failed,
      chars: text.length
    });
  } catch (e: any) {
    const msg = e?.message ?? 'index failed';
    return Response.json(
      { ok: false, indexed: false, source_url: sourceUrl, error: msg },
      { status: /not configured/.test(msg) ? 503 : 502 }
    );
  }
}
