// In-code embeddings. Verified bit-identical (cosine 1.0000) to what the Make
// scenarios produce, so documents embedded here are retrieved correctly by the
// existing Make QUERY scenario — no Make operations spent on indexing.
//
// Model: gemini-embedding-2 @ 768 dims (matches the Pinecone index dimension and
// the query-side embedding). outputDimensionality MUST stay 768.

const MODEL = process.env.RAG_EMBED_MODEL ?? 'gemini-embedding-2';
const DIMS = Number(process.env.RAG_EMBED_DIMS ?? 768);
const BATCH = 100; // Gemini batchEmbedContents cap
// 4 → 8 (2026-07-04): under a concurrent bulk import, Gemini rate-limits and
// the old ~6s total backoff SURRENDERED — one embed batch failing fails the
// whole document with "0 chunks" (by design: no silent loss). Same patience
// rule as the Pinecone upserts (4a09eac): a batch-load retry budget is
// measured in tens of seconds; 429 means "pace me", not "stop".
const MAX_RETRY = 8;

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY is not configured');
  return k;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Embed one batch (≤100 texts) with retries. Returns vectors in input order. */
async function embedBatch(texts: string[]): Promise<number[][]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${apiKey()}`;
  const body = JSON.stringify({
    requests: texts.map((text) => ({
      model: `models/${MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: DIMS
    }))
  });

  let lastErr = '';
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      if (res.ok) {
        const j = await res.json();
        const out = (j.embeddings ?? []).map(
          (e: { values: number[] }) => e.values
        );
        if (out.length === texts.length && out.every((v: number[]) => Array.isArray(v) && v.length === DIMS))
          return out;
        lastErr = `shape mismatch: got ${out.length}/${texts.length}`;
      } else {
        lastErr = `HTTP ${res.status}`;
        // 429/5xx → backoff and retry; 4xx (other) → stop early
        if (res.status !== 429 && res.status < 500) {
          throw new Error(`${lastErr}: ${(await res.text()).slice(0, 200)}`);
        }
      }
    } catch (e: any) {
      lastErr = e?.message ?? 'fetch error';
      if (!/HTTP (429|5\d\d)/.test(lastErr) && !/fetch|network|timeout/i.test(lastErr))
        throw e;
    }
    // Exp backoff capped at 15s + jitter (~50s total budget across 8 tries).
    await sleep(Math.min(400 * 2 ** attempt, 15_000) + Math.random() * 400);
  }
  throw new Error(`embedBatch failed after ${MAX_RETRY} attempts: ${lastErr}`);
}

/**
 * Embed many texts. Splits into ≤100-text batches run with light concurrency.
 * Throws if any batch ultimately fails — indexing must never silently lose text
 * (the bug that started this: half a document vanished). Vectors come back in
 * the same order as `texts`.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) batches.push(texts.slice(i, i + BATCH));

  const results: number[][][] = new Array(batches.length);
  const CONCURRENCY = 4;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) {
        const i = next++;
        results[i] = await embedBatch(batches[i]);
      }
    })
  );
  return results.flat();
}

/** Embed a single text (e.g. a query). */
export async function embedText(text: string): Promise<number[]> {
  const [v] = await embedTexts([text]);
  return v;
}
