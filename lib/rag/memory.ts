// Long-term cross-session memory. Past Q&A summaries are embedded and stored in
// a dedicated Pinecone namespace; on a new question we retrieve the most relevant
// ones and feed them in as context — so a brain "remembers" earlier conversations
// across sessions, beyond the in-conversation history/rolling-summary.
//
// Self-contained on purpose: store AND retrieve both embed with the SAME model
// here (gemini-embedding-001, 768d — matches the index dims), so the vectors are
// always in the same space. Summarization runs through the Make utility LLM
// (model managed in Make); only the embedding lives in code, and embedding models
// rarely change. Everything is Pinecone-direct (no Make round-trip on the hot path).

const EMBED_MODEL = process.env.RAG_MEMORY_EMBED_MODEL ?? 'gemini-embedding-001';
const TOP_K = Number(process.env.RAG_MEMORY_TOPK ?? 3);
const MIN_SCORE = Number(process.env.RAG_MEMORY_MIN_SCORE ?? 0.55);

function memNamespace(): string {
  return `${process.env.PINECONE_NAMESPACE ?? 'user_kieffer'}__mem`;
}
function pineconeHost(): string | null {
  const h = process.env.PINECONE_HOST;
  return h ? `https://${h.replace(/^https?:\/\//, '')}` : null;
}

async function embedText(text: string): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !text.trim()) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 8000) }] },
          outputDimensionality: 768
        })
      }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.embedding?.values;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** Embed a memory summary and upsert it to the memory namespace. */
export async function storeMemory(text: string): Promise<boolean> {
  const host = pineconeHost();
  const key = process.env.PINECONE_API_KEY;
  if (!host || !key) return false;
  const values = await embedText(text);
  if (!values) return false;
  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const r = await fetch(`${host}/vectors/upsert`, {
      method: 'POST',
      headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        namespace: memNamespace(),
        vectors: [{ id, values, metadata: { text, ts: Date.now() } }]
      })
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Retrieve the most relevant past-conversation memories for a question. */
export async function retrieveMemories(question: string): Promise<string[]> {
  const host = pineconeHost();
  const key = process.env.PINECONE_API_KEY;
  if (!host || !key) return [];
  const values = await embedText(question);
  if (!values) return [];
  try {
    const r = await fetch(`${host}/query`, {
      method: 'POST',
      headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        namespace: memNamespace(),
        vector: values,
        topK: TOP_K,
        includeMetadata: true
      })
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.matches ?? [])
      .filter((m: { score?: number }) => (m.score ?? 0) >= MIN_SCORE)
      .map((m: { metadata?: { text?: string } }) => m.metadata?.text)
      .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0);
  } catch {
    return [];
  }
}
