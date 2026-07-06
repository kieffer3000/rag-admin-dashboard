import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { indexText } from '@/lib/rag/index-core';
import { nsForUser } from '@/lib/rag/namespace';
import { resolvePlan } from '@/lib/rag/plans';
import { namespaceVectorCount, bumpUsage, monthPeriod } from '@/lib/rag/metering';
import { extractPdfViaCloudConvert, pollDocText } from '@/lib/rag/cloudconvert';

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

async function extractPdf(bytes: Uint8Array, ocr = false): Promise<string> {
  // PRIMARY: CloudConvert "no-fail" path — repairs corrupt PDFs (3heights) and
  // extracts via pdf→rtf→txt (or pdf→docx with OCR when `ocr`, for scanned PDFs).
  const cc = await extractPdfViaCloudConvert(bytes, 'input.pdf', { ocr });
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
  const { userId, has } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // STORAGE GATE (3.17): banked vectors vs plan cap, measured live from
  // Pinecone. Fail-open (can't measure → allow). Mirrors /api/index.
  const { caps } = await resolvePlan(userId, has);
  if (Number.isFinite(caps.vectorsMax)) {
    const banked = await namespaceVectorCount(nsForUser(userId));
    if (banked !== null && banked >= caps.vectorsMax) {
      return Response.json(
        {
          error: `Storage limit reached (${caps.vectorsMax.toLocaleString()} vectors). Delete sources you no longer need, or upgrade your plan.`
        },
        { status: 429 }
      );
    }
  }
  void bumpUsage(`user:${userId}`, 'uploads', monthPeriod());

  // ── JSON job mode ──────────────────────────────────────────────────────────
  // The client uploaded the RAW file straight to CloudConvert (no 4.5MB cap) and
  // sends us the jobId. We poll it, fetch the SMALL extracted text, and run the
  // identical chunk→embed→Pinecone pipeline. This is how big books get indexed.
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null);
    const sourceId = String(body?.source_id ?? '').trim();
    const name = String(body?.name ?? '').trim() || 'Document';
    const ccJobId = String(body?.cc_job_id ?? '').trim();
    if (!sourceId || !ccJobId) {
      return Response.json(
        { ok: false, error: 'source_id and cc_job_id are required' },
        { status: 400 }
      );
    }
    const tPoll0 = Date.now();
    const poll = await pollDocText(ccJobId);
    const pollMs = Date.now() - tPoll0;
    if (poll.state === 'converting') {
      // The conversion OUTLIVED this request's poll window (big books run
      // 5-10+ min) — it is still running and will finish. Tell the client to
      // re-attach to the SAME job; a fresh request finds the text instantly
      // once done. Never a new job: re-minting re-bills and re-times-out.
      return Response.json({
        ok: false,
        converting: true,
        cc_job_id: ccJobId,
        error: 'Still converting — large document; retrying automatically.'
      });
    }
    // BUDGET RACE (2026-07-05): a conversion that finishes LATE in this
    // window leaves too little of the 300s cap to index a big book — the
    // request 504s mid-index ("index failed" on a conversion the ledger
    // shows succeeded). Decline to index in a dying window; the client
    // re-attaches, the next poll returns in ~2s, and indexing gets a full
    // fresh budget.
    if (poll.state === 'finished' && pollMs > 150_000) {
      return Response.json({
        ok: false,
        converting: true,
        cc_job_id: ccJobId,
        error: 'Converted — indexing on the next pass with a fresh time budget.'
      });
    }
    const txtUrl = poll.url;
    if (!txtUrl) {
      return Response.json(
        { ok: false, error: 'Text extraction failed or timed out.' },
        { status: 502 }
      );
    }
    let text = '';
    try {
      const tr = await fetch(txtUrl);
      if (!tr.ok) throw new Error(`fetch text ${tr.status}`);
      text = (await tr.text()).trim();
    } catch (e: any) {
      return Response.json(
        { ok: false, error: `Could not read extracted text: ${e?.message ?? 'error'}` },
        { status: 502 }
      );
    }
    if (text.length < 20) {
      return Response.json({
        ok: false,
        indexed: false,
        note: 'No extractable text — possibly a scanned/image PDF. Re-upload with OCR on.'
      });
    }
    // CEILING BACKSTOP: the presign hop's 50MB gate trusts a client-declared
    // size, so cap what we'll actually INDEX by the extracted text itself.
    // 12M chars ≈ several thousand book pages — beyond that it's not a
    // document, it's a dataset dump.
    const MAX_TEXT_CHARS = 12_000_000;
    if (text.length > MAX_TEXT_CHARS) {
      return Response.json({
        ok: false,
        indexed: false,
        note: `Extracted text is ${(text.length / 1_000_000).toFixed(1)}M characters — over the indexing limit. Split the document and upload the parts.`
      });
    }
    // Store the extracted text as the openable source (the raw file stayed on
    // CloudConvert; the text is what we cite from anyway).
    let sourceUrl: string | undefined;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const blob = await put(`docs/${userId}/${sourceId}.txt`, text, {
          access: 'public',
          addRandomSuffix: true,
          contentType: 'text/plain'
        });
        sourceUrl = blob.url;
      } catch {
        /* best-effort */
      }
    }
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
  // ── end JSON job mode ──────────────────────────────────────────────────────

  let form: FormData;
  // Timing probe (2026-07-04): reading the multipart body measures the
  // CLIENT'S upload — the missing wall-time suspect (server work per doc
  // measured healthy while completions lag ~3x behind).
  const tBody0 = Date.now();
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }
  const tBody = Date.now() - tBody0;

  const file = form.get('file');
  const name = String(form.get('name') ?? '').trim() || 'Document';
  const sourceId = String(form.get('source_id') ?? '').trim();
  const ocr = ['true', '1', 'on'].includes(String(form.get('ocr') ?? '').toLowerCase());
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
  // NOTE: audio is transcribed CLIENT-side via OpenAI Whisper (/api/transcribe)
  // and indexed as text through /api/index — it never reaches this route as a
  // file. Documents only.
  if (!isPdf && !isDocx && !isEpub && !isTxt) {
    return Response.json(
      { error: `Unsupported type ${mime || lowerName}. Use PDF, DOCX, EPUB, TXT, or MD.` },
      { status: 415 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  console.info(
    `[doc-timing] ${sourceId} bodyRead=${tBody}ms bytes=${file.size} name=${lowerName.slice(0, 40)}`
  );

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
    if (isPdf) text = await extractPdf(new Uint8Array(buf), ocr);
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
