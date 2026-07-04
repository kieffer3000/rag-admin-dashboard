// IMAGE upload prep (client). Vercel's ~4.5MB request-body cap rejects a raw
// phone photo POSTed to /api/index-image BEFORE the route runs (its in-route
// 12MB check is unreachable above the cap — same trap as the book uploads).
// Indexing never needs print resolution, so instead of a converter hop we
// simply DOWNSCALE client-side: longest edge ≤ 2048px, JPEG q0.85. That puts
// virtually any camera photo far under the cap while keeping every visual
// detail the multimodal indexer can actually use.

const CAP_SAFE = 4 * 1024 * 1024; // stay under the ~4.5MB platform cap
/** Refuse to even attempt decode above this — protects browser memory. */
const MAX_SOURCE = 60 * 1024 * 1024;
const MAX_EDGE = 2048;

/** Returns a File safe to POST to /api/index-image. Throws a human message
 *  when the image can't be brought under the cap (undecodable/huge). */
export async function prepareImageForIndex(file: File): Promise<File> {
  if (file.size <= CAP_SAFE) return file;
  if (file.size > MAX_SOURCE) {
    throw new Error(
      `Image is ${(file.size / 1048576).toFixed(0)} MB — too large to upload. Max is ${MAX_SOURCE / 1048576} MB.`
    );
  }

  // Decode → downscale → re-encode. createImageBitmap handles JPEG/PNG/WebP
  // (and HEIC on Safari); an undecodable format lands in the catch.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      `Image is ${(file.size / 1048576).toFixed(1)} MB (over the ~4 MB upload limit) and couldn't be resized in the browser — convert it to JPEG/PNG and try again.`
    );
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/jpeg', 0.85)
    );
    if (!blob || blob.size > CAP_SAFE)
      throw new Error('Image could not be compressed under the upload limit.');
    const name = file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
