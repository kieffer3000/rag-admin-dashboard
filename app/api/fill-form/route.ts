import { auth } from '@clerk/nextjs/server';
import { embedTexts } from '@/lib/rag/embed';
import { generateText, parseJsonObject } from '@/lib/rag/generate';
import { nsForUser } from '@/lib/rag/namespace';
import { scopeOf, getOrgOpenrouterKey } from '@/lib/org-settings';
import { resolvePlan, BYOK_QUESTION_MULTIPLIER } from '@/lib/rag/plans';
import { gateUsage, readUsage, monthPeriod } from '@/lib/rag/metering';

// SMART FORM FILLING (Build 3.29). The client reads a fillable PDF's AcroForm
// field list with pdf-lib (the form itself NEVER leaves the browser — only
// field names/labels/options arrive here), we answer each field from the wired
// sources (retrieval + ONE JSON generation call), and the client writes the
// values back into the PDF locally. Billing: one fill = 3 question credits
// (research-class: one batched LLM pass regardless of field count).
//
// Request:  { fields: [{ name, type, label?, options?[] }], source_ids?: [],
//             extra_text?: string }
// Response: { values: { name: string|boolean }, evidence: { name: source },
//             sourcesUsed: [names] }

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_FIELDS = 120;
const MAX_CONTEXT_CHARS = 26_000;
const MAX_EXTRA_CHARS = 20_000;

interface FormField {
  name: string;
  type: string;
  label?: string;
  options?: string[];
}

function pineconeConfig(): { base: string; key: string } | null {
  const h = process.env.PINECONE_HOST;
  const k = process.env.PINECONE_API_KEY;
  return h && k ? { base: `https://${h.replace(/^https?:\/\//, '')}`, key: k } : null;
}

/** One filtered Pinecone query → matched chunks (id, text, source_name). */
async function queryChunks(
  vector: number[],
  namespace: string,
  sourceIds: string[],
  topK: number
): Promise<Array<{ text: string; source: string }>> {
  const cfg = pineconeConfig();
  if (!cfg) return [];
  try {
    const r = await fetch(`${cfg.base}/query`, {
      method: 'POST',
      headers: { 'Api-Key': cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        namespace,
        vector,
        topK,
        includeMetadata: true,
        ...(sourceIds.length ? { filter: { source_id: { $in: sourceIds } } } : {})
      })
    });
    if (!r.ok) return [];
    const j = await r.json();
    return ((j.matches ?? []) as Array<{ metadata?: Record<string, unknown> }>)
      .map((m) => ({
        text: typeof m.metadata?.text === 'string' ? (m.metadata.text as string) : '',
        source:
          typeof m.metadata?.source_name === 'string'
            ? (m.metadata.source_name as string)
            : 'source'
      }))
      .filter((c) => c.text);
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  const { userId, orgId, has } = await auth();
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const rawFields: unknown = body?.fields;
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    return Response.json({ error: 'fields[] is required' }, { status: 400 });
  }
  const fields: FormField[] = (rawFields as FormField[])
    .filter((f) => f && typeof f.name === 'string' && f.name.trim())
    .slice(0, MAX_FIELDS);
  const sourceIds: string[] = Array.isArray(body?.source_ids)
    ? body.source_ids.filter((s: unknown) => typeof s === 'string' && s)
    : [];
  const extraText =
    typeof body?.extra_text === 'string' ? body.extra_text.slice(0, MAX_EXTRA_CHARS) : '';
  if (sourceIds.length === 0 && !extraText.trim()) {
    return Response.json(
      { error: 'Wire at least one data source (indexed documents or pasted text).' },
      { status: 400 }
    );
  }

  // METERING: one form fill = 3 question credits (research-class), same
  // allowance math as /api/query (plan × BYOK + top-ups). Fail-open.
  const plan = await resolvePlan(userId, has);
  if (Number.isFinite(plan.caps.questionsPerMonth)) {
    const scope = scopeOf(orgId, userId);
    const byok = !!(await getOrgOpenrouterKey(scope));
    const topup = await readUsage(scope, 'topup_questions', monthPeriod());
    const credits =
      plan.caps.questionsPerMonth * (byok ? BYOK_QUESTION_MULTIPLIER : 1) + topup;
    const gate = await gateUsage(scope, 'questions', monthPeriod(), credits, 3);
    if (!gate.ok) {
      return Response.json(
        {
          error: `Monthly question credits used up (${credits}). Buy a credit pack or wait for the monthly reset.`
        },
        { status: 429 }
      );
    }
  }

  // Retrieval: one embedding batch for ALL field questions, then parallel
  // filtered queries. Dedup chunks across fields, cap total context.
  const ns = nsForUser(userId);
  let context = '';
  if (sourceIds.length) {
    const questions = fields.map(
      (f) => `What is the value for the form field "${f.label || f.name}"?`
    );
    let vectors: number[][] = [];
    try {
      vectors = await embedTexts(questions);
    } catch {
      vectors = [];
    }
    if (vectors.length === questions.length) {
      const perField = await Promise.all(
        vectors.map((v) => queryChunks(v, ns, sourceIds, 3))
      );
      const seen = new Set<string>();
      const parts: string[] = [];
      let chars = 0;
      for (const chunks of perField) {
        for (const c of chunks) {
          const key = c.text.slice(0, 80);
          if (seen.has(key)) continue;
          seen.add(key);
          if (chars + c.text.length > MAX_CONTEXT_CHARS) break;
          chars += c.text.length;
          parts.push(`[${c.source}] ${c.text}`);
        }
      }
      context = parts.join('\n---\n');
    }
  }
  if (extraText.trim()) {
    context = `${context ? context + '\n---\n' : ''}[Pasted data] ${extraText.trim()}`;
  }
  if (!context) {
    return Response.json(
      { error: 'Could not read any content from the selected sources.' },
      { status: 422 }
    );
  }

  const fieldSpec = fields
    .map((f) => {
      const opts = f.options?.length ? ` options=${JSON.stringify(f.options)}` : '';
      return `- name=${JSON.stringify(f.name)} type=${f.type}${f.label ? ` label=${JSON.stringify(f.label)}` : ''}${opts}`;
    })
    .join('\n');

  const prompt = `You are filling out a form. Using ONLY the source material below, determine the value for each form field.

RULES:
- Answer ONLY from the source material. If the material does not contain a field's value, use "" (empty string). NEVER invent a value.
- checkbox fields: true or false only.
- dropdown/radio/optionlist fields: the value MUST be copied verbatim from that field's options list (or "" if none applies).
- Dates/phone numbers/amounts: use the format the field label implies; otherwise copy the source's format.
- Return STRICT JSON, nothing else:
  {"values": {"<field name>": <string or boolean>}, "evidence": {"<field name>": "<name of the source the value came from, or ''>"}}

FORM FIELDS:
${fieldSpec}

SOURCE MATERIAL:
${context}`;

  let raw: string;
  try {
    raw = await generateText(prompt, {
      direct: true,
      json: true,
      temperature: 0.1,
      thinkingBudget: 0,
      maxOutputTokens: 4000
    });
  } catch (e) {
    console.error('[fill-form] generation failed', e);
    return Response.json(
      { error: 'The form-filling engine is temporarily unavailable. Try again.' },
      { status: 502 }
    );
  }

  const parsed = parseJsonObject<{
    values?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
  }>(raw);
  if (!parsed || !parsed.values || typeof parsed.values !== 'object') {
    return Response.json(
      { error: 'The engine returned an unreadable result. Try again.' },
      { status: 502 }
    );
  }

  // Shape-guard: only requested fields, only string/boolean values.
  const values: Record<string, string | boolean> = {};
  const evidence: Record<string, string> = {};
  for (const f of fields) {
    const v = parsed.values[f.name];
    if (typeof v === 'boolean') values[f.name] = v;
    else if (typeof v === 'string') values[f.name] = v;
    else if (typeof v === 'number') values[f.name] = String(v);
    else values[f.name] = '';
    const ev = parsed.evidence?.[f.name];
    evidence[f.name] = typeof ev === 'string' ? ev : '';
  }
  const sourcesUsed = [...new Set(Object.values(evidence).filter(Boolean))];

  console.info(
    `[fill-form] fields=${fields.length} sources=${sourceIds.length} filled=${Object.values(values).filter((v) => v !== '').length}`
  );
  return Response.json({ values, evidence, sourcesUsed });
}
