// The "Opine" engine — a body of knowledge (LEFT plug = RAG corpus) reasoning ABOUT
// an artifact (RIGHT plug, carried whole, NEVER indexed), optionally guided by
// references (TOP plug = exemplars/clues) and a robot (agent/prompt → guides = a
// persona LENS, not a citable source).
//
// Why this is not just /api/query: the corpus must opine on the artifact, which
// inverts the flow. The trick (design doc BRAIN_PLUGS_OPINE_DESIGN.md): ask the
// corpus what GOOD looks like BEFORE showing it the artifact — otherwise the model
// anchors on what's present and misses what's ABSENT ("absence has no vector").
//
// Two-pass, orchestrated IN CODE (the reason Opine synthesizes here, not in Make):
//   Pass B (rubric)  — Conductor fans the intent into probes → retrieve per probe
//                      from the corpus (artifact NOT involved) → an evidence pool.
//   Pass A (check)   — synthesize: derive the criteria from the pool, THEN judge the
//                      artifact against them, grounded + cited (toggle-able).
//
// Grounding rule that survives every operation/persona: the evidence pool is the
// ONLY citable truth. The robot shapes voice/priorities, never grounding.

import { embedText } from '@/lib/rag/embed';
import { generateText, parseJsonObject } from '@/lib/rag/generate';

const MAX_POOL_CHARS = Number(process.env.OPINE_MAX_POOL_CHARS ?? 28000);
const MAX_ARTIFACT_CHARS = Number(process.env.OPINE_MAX_ARTIFACT_CHARS ?? 24000);
const TOPK_PER_PROBE = Number(process.env.OPINE_TOPK_PER_PROBE ?? 6);
const MAX_PROBES = Number(process.env.OPINE_MAX_PROBES ?? 8);
// Conductor = a small/fast model with THINKING OFF for reliable JSON fan-out
// (verified: gemini-2.5-pro's thinking starves a small output budget → 1-probe
// fallback). Synthesis = the strong model with a real budget for full critiques.
const CONDUCTOR_MODEL = process.env.OPINE_CONDUCTOR_MODEL ?? 'gemini-2.5-flash';
const SYNTH_MAX_TOKENS = Number(process.env.OPINE_SYNTH_MAX_TOKENS ?? 6000);

export interface Artifact {
  title?: string;
  url?: string;
  content: string;
}

export interface PoolChunk {
  id: string;
  score: number;
  source_id: string;
  source_name: string;
  text: string;
}

export interface OpinePlan {
  /** critique | assist | ideate | transform | answer */
  operation: string;
  /** corpus fan-out queries (Pass B). Derived from the INTENT, not the artifact. */
  probes: string[];
  /** does this op need a corpus rubric (gap/absence detection)? */
  needsRubric: boolean;
  /** what the reply should look like, for the synthesis step. */
  outputShape: string;
}

export interface OpineResult {
  answer: string;
  pool: PoolChunk[];
  plan: OpinePlan;
  topScore: number | null;
  noMatch: boolean;
}

function pcHost(): string | null {
  const h = process.env.PINECONE_HOST;
  return h ? `https://${h.replace(/^https?:\/\//, '')}` : null;
}

/** One Pinecone top-k query (optionally filtered to the wired corpus sources). */
async function pineconeQuery(
  vec: number[],
  namespace: string,
  topK: number,
  sourceIds: string[]
): Promise<Array<{ id: string; score: number; metadata: Record<string, unknown> }>> {
  const base = pcHost();
  const key = process.env.PINECONE_API_KEY;
  if (!base || !key) return [];
  const body: Record<string, unknown> = { namespace, vector: vec, topK, includeMetadata: true };
  if (sourceIds.length) body.filter = { source_id: { $in: sourceIds } };
  try {
    const r = await fetch(`${base}/query`, {
      method: 'POST',
      headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) return [];
    return (await r.json()).matches ?? [];
  } catch {
    return [];
  }
}

/**
 * Pass B retrieval: embed each probe, query the corpus, merge into one deduped
 * evidence pool ordered by relevance and capped. The artifact is deliberately NOT
 * part of any probe — that independence is what lets the rubric surface absences.
 */
export async function retrieveForProbes(
  probes: string[],
  namespace: string,
  sourceIds: string[]
): Promise<PoolChunk[]> {
  const byId = new Map<string, PoolChunk>();
  await Promise.all(
    probes.slice(0, MAX_PROBES).map(async (probe) => {
      if (!probe.trim()) return;
      let vec: number[];
      try {
        vec = await embedText(probe);
      } catch {
        return;
      }
      const matches = await pineconeQuery(vec, namespace, TOPK_PER_PROBE, sourceIds);
      for (const m of matches) {
        const t = m.metadata?.text;
        if (typeof t !== 'string' || !t) continue;
        const prev = byId.get(m.id);
        const score = typeof m.score === 'number' ? m.score : 0;
        if (!prev || score > prev.score) {
          byId.set(m.id, {
            id: m.id,
            score,
            source_id: String(m.metadata.source_id ?? ''),
            source_name: String(m.metadata.source_name ?? 'Source'),
            text: t
          });
        }
      }
    })
  );

  const ordered = [...byId.values()].sort((a, b) => b.score - a.score);
  const out: PoolChunk[] = [];
  let chars = 0;
  for (const c of ordered) {
    chars += c.text.length;
    if (chars > MAX_POOL_CHARS) break;
    out.push(c);
  }
  return out;
}

/**
 * The Conductor: turn the user's loose instruction + the wired plugs into an
 * execution plan (operation + corpus probes + output shape). One LLM call; on any
 * failure we fall back to a safe plan (probe = the instruction itself) so Opine
 * still runs. Probes are intentionally about the SUBJECT MATTER, not the artifact.
 */
export async function runConductor(
  instruction: string,
  ctx: { hasArtifact: boolean; hasReferences: boolean; guides: string[] }
): Promise<OpinePlan> {
  const fallback: OpinePlan = {
    operation: ctx.hasArtifact ? 'critique' : 'answer',
    probes: [instruction.slice(0, 300)],
    needsRubric: ctx.hasArtifact,
    outputShape: ctx.hasArtifact
      ? 'Strengths, weaknesses vs the field, and prioritized recommendations.'
      : 'A direct, grounded answer.'
  };

  const prompt = [
    'You are the CONDUCTOR for a knowledge-grounded reasoning step. A user has wired a body of knowledge (a corpus) to a "brain" and is asking it to act on their work.',
    `User instruction: """${instruction}"""`,
    `An ARTIFACT (the user's own work) is ${ctx.hasArtifact ? 'attached' : 'NOT attached'}.`,
    `REFERENCE samples are ${ctx.hasReferences ? 'attached' : 'NOT attached'}.`,
    ctx.guides.length ? `Persona/instructions in effect: ${ctx.guides.join(' | ')}` : 'No special persona.',
    '',
    'Produce an execution plan as JSON with EXACTLY these keys:',
    '- "operation": one of "critique" | "assist" | "ideate" | "transform" | "answer".',
    '- "needsRubric": boolean — true when the task needs to know what GOOD looks like in the field (any critique / "how can I improve" / gap-finding). This drives absence detection.',
    '- "probes": an array of 4-8 SHORT search queries to ask the CORPUS about the SUBJECT MATTER and best practices — NOT about the artifact. These fan out to retrieve what the field says. Make them specific and non-overlapping.',
    '- "outputShape": one sentence describing how the final reply should be structured.',
    '',
    'Return ONLY the JSON object.'
  ].join('\n');

  try {
    const raw = await generateText(prompt, {
      model: CONDUCTOR_MODEL,
      json: true,
      temperature: 0.2,
      maxOutputTokens: 2048,
      thinkingBudget: 0,
      step: 'conductor'
    });
    const j = parseJsonObject<Partial<OpinePlan>>(raw);
    if (!j) return fallback;
    const probes = Array.isArray(j.probes)
      ? j.probes.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : [];
    return {
      operation: typeof j.operation === 'string' ? j.operation : fallback.operation,
      probes: probes.length ? probes.slice(0, MAX_PROBES) : fallback.probes,
      needsRubric: typeof j.needsRubric === 'boolean' ? j.needsRubric : fallback.needsRubric,
      outputShape: typeof j.outputShape === 'string' ? j.outputShape : fallback.outputShape
    };
  } catch {
    return fallback;
  }
}

/**
 * Pass A: synthesize the grounded reply. Derives the field's criteria from the
 * evidence pool FIRST, then judges the artifact against them. Honors the citation
 * toggle (on = inline [n] footnotes into the pool; off = clean prose, still
 * grounded) and the grounding mode (cited = corpus-only; hybrid = may add general
 * knowledge, clearly flagged). The robot `guides` set voice/priorities only.
 */
export async function synthesizeOpine(args: {
  instruction: string;
  artifact: Artifact | null;
  references: Artifact[];
  pool: PoolChunk[];
  plan: OpinePlan;
  citations: 'on' | 'off';
  grounding: 'cited' | 'hybrid';
  guides: string[];
  conversation: string;
}): Promise<string> {
  const { instruction, artifact, references, pool, plan, citations, grounding, guides, conversation } = args;

  const poolText = pool.length
    ? pool.map((c, i) => `[${i + 1}] (source: ${c.source_name})\n${c.text}`).join('\n\n')
    : '(no corpus excerpts retrieved)';

  const artifactText = artifact
    ? `${artifact.title ? `TITLE: ${artifact.title}\n` : ''}${artifact.url ? `URL: ${artifact.url}\n` : ''}${artifact.content.slice(0, MAX_ARTIFACT_CHARS)}`
    : '(no artifact attached)';

  const citationRule =
    citations === 'on'
      ? 'After each claim that draws on the corpus, cite the supporting excerpt number(s) inline like [1] or [2]. Cite ONLY the numbered CORPUS EXCERPTS. Never cite the artifact or the references.'
      : 'Do NOT include any bracketed [n] citation markers or a sources list. Write clean prose. (You are still bound by the corpus — you simply do not show footnotes.)';

  const groundingRule =
    grounding === 'hybrid'
      ? 'Ground your reasoning in the CORPUS EXCERPTS. Where they fall short you MAY add general knowledge, but clearly prefix any such part with "Beyond the corpus:".'
      : 'Ground your reasoning ONLY in the CORPUS EXCERPTS. Do not introduce facts or principles that are not supported by them. If the corpus does not cover something the artifact needs, say so explicitly.';

  const rubricRule = plan.needsRubric
    ? 'FIRST, from the CORPUS EXCERPTS, distill the key criteria / factors the field considers essential (this is what GOOD looks like). THEN evaluate the ARTIFACT against each — what it does well, where it falls short, and crucially what it is MISSING. End with prioritized, concrete recommendations.'
    : 'Use the CORPUS EXCERPTS to inform a direct, helpful response to the instruction, applied to the artifact where relevant.';

  const system = [
    'You are a domain expert who speaks ONLY through the wired body of knowledge (the corpus). You are rigorous, specific, and honest about gaps.',
    guides.length
      ? `Adopt this persona / follow these instructions for TONE and PRIORITIES only — they do NOT let you invent facts or ignore the corpus: ${guides.join(' | ')}`
      : ''
  ].filter(Boolean).join('\n');

  const prompt = [
    conversation ? `CONVERSATION SO FAR:\n${conversation}\n` : '',
    'CORPUS EXCERPTS (the only citable sources):',
    poolText,
    '',
    'ARTIFACT (the user\'s own work — NOT a source, never cite it):',
    artifactText,
    references.length
      ? `\nREFERENCE SAMPLES (targets/clues — NOT a source, never cite them):\n${references.map((r, i) => `(${i + 1}) ${r.title ?? 'reference'}: ${r.content.slice(0, 4000)}`).join('\n\n')}`
      : '',
    '',
    `USER INSTRUCTION: ${instruction}`,
    '',
    'HOW TO RESPOND:',
    `- ${rubricRule}`,
    `- ${groundingRule}`,
    `- ${citationRule}`,
    `- Target structure: ${plan.outputShape}`,
    '- Write clean semantic HTML only (<p>, <strong>, <em>, <h4>, <ul>/<li>). No markdown, no <html>/<body> wrapper.',
    ''
  ].filter(Boolean).join('\n');

  return generateText(prompt, { system: system || undefined, temperature: 0.35, maxOutputTokens: SYNTH_MAX_TOKENS, step: 'synthesis' });
}

/** Full Opine run: Conductor → corpus fan-out → grounded synthesis. */
export async function runOpine(args: {
  instruction: string;
  namespace: string;
  sourceIds: string[];
  artifact: Artifact | null;
  references: Artifact[];
  citations: 'on' | 'off';
  grounding: 'cited' | 'hybrid';
  guides: string[];
  conversation: string;
}): Promise<OpineResult> {
  const plan = await runConductor(args.instruction, {
    hasArtifact: !!args.artifact,
    hasReferences: args.references.length > 0,
    guides: args.guides
  });

  const pool = await retrieveForProbes(plan.probes, args.namespace, args.sourceIds);
  const topScore = pool.length ? Math.max(...pool.map((c) => c.score)) : null;

  const answer = await synthesizeOpine({
    instruction: args.instruction,
    artifact: args.artifact,
    references: args.references,
    pool,
    plan,
    citations: args.citations,
    grounding: args.grounding,
    guides: args.guides,
    conversation: args.conversation
  });

  return { answer, pool, plan, topScore, noMatch: pool.length === 0 };
}
