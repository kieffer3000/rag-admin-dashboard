// EXACT-MENTION LEXICAL LANE (Build 3.16).
//
// Semantic-only retrieval fails on rare exact tokens BY CONSTRUCTION: a proper
// name inside a passage contributes almost nothing to that chunk's embedding,
// so "is Kathy mentioned anywhere in this book" retrieves name-dense chunks
// (references lists) while the actual case study never ranks. (Real incident:
// the Hersen Encyclopedia's Kathy functional-analysis study, 2026-07-06.)
//
// This lane is the LEXICAL finder that rides beside the vector finder: when a
// question names an exact term (quoted phrase, proper noun, or an
// "is X mentioned"-style ask), we exhaustively fetch the wired sources' chunks
// straight from Pinecone (ids are SEQUENTIAL — `src#i` or `src#p{n}-{i}` — so
// this is constructed-id batch fetches, NOT slow prefix listing) and literal-
// match the term. Hits are injected into the answer via the same
// `injected_context` mechanism escalation already uses — no Make change.
//
// Cost: fetch = 1 RU per 10 records → a 20k-chunk book ≈ 2k RU ≈ $0.03.
// Runs CONCURRENTLY with the first Make pass, so added latency is usually zero;
// a second Make call happens only when the scan found chunks the first answer
// never saw.

import { type ContextChunk, parseChunkId } from '@/lib/rag/expand';

// Caps: keep the lane bounded no matter what's wired.
const MAX_CHUNKS_PER_SOURCE = Number(process.env.RAG_MENTION_MAX_PER_SOURCE ?? 40_000);
const MAX_CHUNKS_TOTAL = Number(process.env.RAG_MENTION_MAX_TOTAL ?? 120_000);
const MAX_PARTS = 50; // part-scoped ids: #p1-0 … #p50-…
const FETCH_BATCH = 100; // Pinecone fetch cap per call
const PARALLEL_BATCHES = 5; // batches in flight per round
/** A term matching MORE chunks than this is a COMMON entity (e.g. the book's
 *  own subject) — semantic retrieval already covers those; exhaustive injection
 *  wouldn't fit the context window anyway. The lane targets RARE terms. */
export const RARE_TERM_MAX_MATCHES = 60;
const MAX_CONTEXT_CHARS = Number(process.env.RAG_ESCALATE_MAX_CHARS ?? 30000);

function host(): string | null {
  const h = process.env.PINECONE_HOST;
  return h ? `https://${h.replace(/^https?:\/\//, '')}` : null;
}

// ---------------------------------------------------------------------------
// Term extraction
// ---------------------------------------------------------------------------

// Words that look like proper nouns mid-sentence but aren't search terms, plus
// generic ask-vocabulary captured by the intent patterns.
const STOP = new Set(
  (
    'the a an and or but of in on at to for with about from by as is are was were be been ' +
    'this that these those it its his her their our your my i you he she we they them him ' +
    'what which who whom whose when where why how does do did can could would should may might ' +
    'book books source sources document documents chapter section page pages text corpus library ' +
    'anywhere anything something everything nothing mention mentioned mentions discuss discussed ' +
    'discusses regarding regards reference referenced references named name info information ' +
    'detail details tell say says said explain describe covered cover topic subject person people ' +
    'god january february march april may june july august september october november december ' +
    'monday tuesday wednesday thursday friday saturday sunday'
  ).split(/\s+/)
);

function clean(term: string): string {
  return term.trim().replace(/^["'“”‘’]+|["'“”‘’.,;:!?]+$/g, '');
}

/** Pull exact-match search terms out of a question: quoted phrases, lowercase
 *  names in "is X mentioned"-style asks, and mid-sentence capitalized tokens.
 *  Conservative by design — an empty result just means the lane stays off. */
export function extractMentionTerms(question: string): string[] {
  const q = question ?? '';
  const found: string[] = [];

  // 1) Quoted phrases — the strongest signal of exact-match intent.
  for (const m of q.matchAll(/"([^"]{2,60})"|“([^”]{2,60})”|'([^']{2,60})'/g)) {
    const t = clean(m[1] ?? m[2] ?? m[3] ?? '');
    if (t) found.push(t);
  }

  // 2) Explicit mention-intent with a (possibly lowercase) object.
  const intents = [
    /\b(?:is|was|are|were)\s+([\w'’-]{3,30})\s+(?:mentioned|discussed|referenced|named|described|covered)/gi,
    /\b(?:any\s+)?mentions?\s+of\s+([\w'’-]{3,30})/gi,
    /\bwho\s+(?:is|was)\s+([\w'’-]{3,30})\b/gi,
    /\b(?:regarding|about)\s+([\w'’-]{3,30})\s+and\b/gi
  ];
  for (const re of intents) {
    for (const m of q.matchAll(re)) {
      const t = clean(m[1] ?? '');
      if (t && !STOP.has(t.toLowerCase())) found.push(t);
    }
  }

  // 3) Mid-sentence capitalized tokens (proper nouns), up to 3 words long.
  //    Skip the first word of the question / of each sentence.
  const words = q.split(/\s+/);
  let sentenceStart = true;
  for (const raw of words) {
    const w = clean(raw);
    const isCap = /^[A-Z][a-z'’-]{2,24}$/.test(w);
    if (isCap && !sentenceStart && !STOP.has(w.toLowerCase())) found.push(w);
    sentenceStart = /[.!?]$/.test(raw);
  }

  // Dedup case-insensitively, drop terms contained in longer found phrases.
  const uniq: string[] = [];
  for (const t of found) {
    const lo = t.toLowerCase();
    if (STOP.has(lo) || lo.length < 3) continue;
    if (uniq.some((u) => u.toLowerCase() === lo)) continue;
    uniq.push(t);
  }
  return uniq
    .filter((t, _, arr) => !arr.some((o) => o !== t && o.toLowerCase().includes(t.toLowerCase())))
    .slice(0, 4);
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

interface FetchedChunk {
  id: string;
  text: string;
  sourceId: string;
  sourceName?: string;
}

/** One Pinecone fetch of ≤100 constructed ids → the chunks that exist. */
async function fetchBatch(
  ids: string[],
  namespace: string,
  key: string,
  base: string
): Promise<FetchedChunk[]> {
  const u = new URL(`${base}/vectors/fetch`);
  u.searchParams.set('namespace', namespace);
  ids.forEach((id) => u.searchParams.append('ids', id));
  try {
    const r = await fetch(u, { headers: { 'Api-Key': key } });
    if (!r.ok) return [];
    const j = await r.json();
    const out: FetchedChunk[] = [];
    for (const [id, v] of Object.entries((j.vectors ?? {}) as Record<string, any>)) {
      const m = v?.metadata ?? {};
      if (typeof m.text === 'string' && m.text)
        out.push({ id, text: m.text, sourceId: m.source_id, sourceName: m.source_name });
    }
    return out;
  } catch {
    return [];
  }
}

function termRegex(term: string): RegExp {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${esc}\\b`, 'i');
}

export interface MentionScanResult {
  /** Aggregator-shaped matched chunks (ordered by source, then position). */
  hits: ContextChunk[];
  /** Total chunks lexically scanned across the wired sources. */
  scanned: number;
  /** True if a cap stopped the scan before covering everything wired. */
  truncated: boolean;
}

/** Walk one source's sequential chunk ids (`#i` or `#p{n}-{i}`), matching
 *  `res` against each chunk's text. Mutates `state`. */
async function scanSource(
  sourceId: string,
  namespace: string,
  key: string,
  base: string,
  res: RegExp[],
  state: { matches: FetchedChunk[]; scanned: number }
): Promise<boolean> {
  // Shape probe: flat (`#0`) vs part-scoped (`#p1-0`) — one cheap fetch.
  const probe = await fetchBatch([`${sourceId}#0`, `${sourceId}#p1-0`], namespace, key, base);
  const flat = probe.some((c) => c.id === `${sourceId}#0`);
  const parts = probe.some((c) => c.id === `${sourceId}#p1-0`);
  if (!flat && !parts) return true; // nothing under this source (or legacy shape) — skip

  const budgetLeft = () =>
    state.scanned < MAX_CHUNKS_TOTAL ? MAX_CHUNKS_PER_SOURCE : 0;

  const walk = async (idFor: (i: number) => string): Promise<void> => {
    let i = 0;
    let done = false;
    const perSourceCap = budgetLeft();
    while (!done && i < perSourceCap && state.scanned < MAX_CHUNKS_TOTAL) {
      // A round of parallel batches.
      const starts: number[] = [];
      for (let b = 0; b < PARALLEL_BATCHES && i + b * FETCH_BATCH < perSourceCap; b++)
        starts.push(i + b * FETCH_BATCH);
      const results = await Promise.all(
        starts.map((s) =>
          fetchBatch(
            Array.from({ length: FETCH_BATCH }, (_, k) => idFor(s + k)),
            namespace,
            key,
            base
          )
        )
      );
      for (const batch of results) {
        state.scanned += batch.length;
        for (const c of batch) if (res.some((re) => re.test(c.text))) state.matches.push(c);
        if (batch.length < FETCH_BATCH) done = true; // tail reached
      }
      i += starts.length * FETCH_BATCH;
    }
  };

  if (flat) await walk((i) => `${sourceId}#${i}`);
  if (parts) {
    for (let p = 1; p <= MAX_PARTS && state.scanned < MAX_CHUNKS_TOTAL; p++) {
      const head = await fetchBatch([`${sourceId}#p${p}-0`], namespace, key, base);
      if (head.length === 0) break; // no such part → done
      await walk((i) => `${sourceId}#p${p}-${i}`);
    }
  }
  return state.scanned < MAX_CHUNKS_TOTAL;
}

/**
 * Exhaustively literal-match `terms` across the wired sources' chunks.
 * Best-effort: any failure returns what was found so far (or nothing) —
 * the semantic answer path never depends on this lane succeeding.
 */
export async function mentionScan(
  terms: string[],
  sourceIds: string[],
  namespace: string
): Promise<MentionScanResult> {
  const base = host();
  const key = process.env.PINECONE_API_KEY;
  const empty: MentionScanResult = { hits: [], scanned: 0, truncated: false };
  if (!base || !key || terms.length === 0 || sourceIds.length === 0) return empty;

  const res = terms.map(termRegex);
  const state = { matches: [] as FetchedChunk[], scanned: 0 };
  let truncated = false;
  for (const sid of sourceIds) {
    const ok = await scanSource(sid, namespace, key, base, res, state);
    if (!ok) {
      truncated = true;
      break;
    }
  }

  // Order by source then chunk position (reading order), cap context chars.
  const ordered = state.matches
    .map((c) => ({ c, p: parseChunkId(c.id) }))
    .sort((a, b) => {
      const sa = a.c.sourceId ?? '',
        sb = b.c.sourceId ?? '';
      if (sa !== sb) return sa < sb ? -1 : 1;
      return (a.p?.i ?? 0) - (b.p?.i ?? 0);
    });

  const hits: ContextChunk[] = [];
  let chars = 0;
  for (const { c } of ordered) {
    chars += c.text.length;
    if (chars > MAX_CONTEXT_CHARS) {
      truncated = true;
      break;
    }
    hits.push({
      // Literal match = certainty; score above any cosine hit so downstream
      // ordering keeps these visible.
      score: 0.99,
      metadata: { source_id: c.sourceId, source_name: c.sourceName, text: c.text }
    });
  }

  console.info(
    `[mention-scan] terms=${JSON.stringify(terms)} scanned=${state.scanned} matches=${state.matches.length} injectable=${hits.length}${truncated ? ' TRUNCATED' : ''}`
  );
  return { hits, scanned: state.scanned, truncated };
}
