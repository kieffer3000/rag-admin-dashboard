import { auth } from '@clerk/nextjs/server';
import { extractDocumentText } from '@/lib/rag/doc-extract';

// Extract-only file reader for the Opine ARTIFACT (right plug). Pulls the text
// from an uploaded PDF/DOCX/EPUB/TXT/MD and returns it — WITHOUT indexing it into
// Pinecone (artifacts are carried whole, never part of the knowledge base).

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

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
  const ocr = ['true', '1', 'on'].includes(String(form.get('ocr') ?? '').toLowerCase());
  if (!(file instanceof Blob)) {
    return Response.json({ ok: false, note: 'A file is required.' }, { status: 200 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { ok: false, note: `File is ${(file.size / 1048576).toFixed(1)} MB; max is 25 MB.` },
      { status: 200 }
    );
  }

  const filename = (file as File).name ?? 'document';
  const result = await extractDocumentText(file, filename, ocr);
  return Response.json(result, { status: 200 });
}
