// Conservative time estimates for the upload windows.
//
// MEASURED (2026-07-04, 164-book import at full width): converter-path
// documents (PDF/DOCX/EPUB — extracted via CloudConvert) averaged ~2 min
// each end-to-end with batch throughput ~3.4 docs/min; plain text (TXT/MD)
// ~30s. Conversion time tracks page count, not megabytes (measured 10s/MB
// to 146s/MB on the same night), so estimates key off file COUNT and type.
//
// DISPLAY RULE (user-set): quote 50–65% of measured potential — i.e. the
// shown range is 1.5–2× the measured time. Finishing early is a feature;
// finishing late is a complaint.

const CONVERTER_DOC_MIN = 2; // measured minutes per PDF/DOCX/EPUB
const TEXT_DOC_MIN = 0.5; // measured minutes per TXT/MD
const BATCH_DOCS_PER_MIN = 3.4; // measured full-width batch throughput

const CONVERTER = /\.(pdf|epub|docx|doc|rtf|odt)$/i;

/** Human ETA range for a picked set of document files, derated to 50–65% of
 *  measured speed. Returns e.g. "≈3–4 min" / "≈45–60 min", or null when
 *  nothing is picked. */
export function uploadEta(files: Array<{ name: string }>): string | null {
  if (!files.length) return null;
  const converterCount = files.filter((f) => CONVERTER.test(f.name)).length;
  const textCount = files.length - converterCount;
  // Potential = the slower of "longest single document" and "queue drain".
  const longestDoc = converterCount ? CONVERTER_DOC_MIN : TEXT_DOC_MIN;
  const queueDrain =
    (converterCount * CONVERTER_DOC_MIN + textCount * TEXT_DOC_MIN) /
    (BATCH_DOCS_PER_MIN * CONVERTER_DOC_MIN); // count/rate, weighted by class
  const potential = Math.max(longestDoc, queueDrain);
  const lo = Math.max(1, Math.ceil(potential / 0.65));
  const hi = Math.max(lo + 1, Math.ceil(potential / 0.5));
  return `≈${lo}–${hi} min`;
}
