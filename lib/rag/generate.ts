// In-code text generation (Gemini generateContent), used by the Opine engine.
//
// The main RAG query path keeps its LLM in Make (visible/editable, BYOK billing).
// Opine's value is in-code ORCHESTRATION (the Conductor's two-pass rubric→check),
// which is painful to express in Make — so its synthesis runs here, directly, with
// the same GEMINI_API_KEY embed.ts already uses. No new dependency (raw fetch).
//
// Prototype scope: billed to the platform Gemini key. Production BYOK can later
// route this through OpenRouter (the org key is decryptable in-code via
// getOrgOpenrouterKey) or fold into a Make scenario — this helper is the only
// thing that would change. Reversible by design.

const MODEL = process.env.OPINE_MODEL ?? 'gemini-2.5-pro';
const MAX_RETRY = 4;

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error('GEMINI_API_KEY is not configured');
  return k;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export interface GenerateOpts {
  model?: string;
  /** 0–2. Lower = more deterministic. Default 0.3 (grounded, low drift). */
  temperature?: number;
  maxOutputTokens?: number;
  /** A system instruction (persona/role framing). */
  system?: string;
  /** Force application/json output (Conductor planning). */
  json?: boolean;
  /** Gemini 2.5 thinking budget. 0 = OFF (thinking tokens otherwise eat the
   *  output budget → empty/truncated replies). Set 0 for structured JSON
   *  planning; omit to let the model decide for prose synthesis. */
  thinkingBudget?: number;
  /** Pipeline step, forwarded to Make so the scenario can route each step to a
   *  different model ('conductor' = fast/JSON, 'synthesis' = strong/long). */
  step?: 'conductor' | 'synthesis';
}

// When set, Opine's LLM calls go through YOUR Make scenario instead of the
// in-code Gemini call — so you can swap/upgrade models in the Make UI without a
// redeploy (same philosophy as the rest of the app). The webhook receives
// { prompt, system, json, step, max_tokens, temperature } and should return the
// text (raw, or {result|text|answer|output:"…"}). On empty/error we fall back to
// the in-code Gemini call so Opine is never dead.
const MAKE_OPINE_WEBHOOK_URL = process.env.MAKE_OPINE_WEBHOOK_URL;

async function generateViaMake(prompt: string, opts: GenerateOpts): Promise<string | null> {
  if (!MAKE_OPINE_WEBHOOK_URL) return null;
  try {
    const r = await fetch(MAKE_OPINE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        system: opts.system ?? '',
        json: !!opts.json,
        step: opts.step ?? 'synthesis',
        max_tokens: opts.maxOutputTokens ?? 0,
        temperature: opts.temperature ?? 0.3
      })
    });
    if (!r.ok) return null;
    const raw = (await r.text()).trim();
    if (!raw || raw === 'Accepted') return null; // queued (scenario not "immediately") → fall back
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object') {
        const v = j.result ?? j.text ?? j.answer ?? j.output;
        if (typeof v === 'string' && v.trim()) return v.trim();
        // json-mode replies may already be the object → re-stringify for the caller to parse
        if (opts.json) return JSON.stringify(j);
        const vals = Object.values(j);
        if (vals.length === 1 && typeof vals[0] === 'string' && (vals[0] as string).trim())
          return (vals[0] as string).trim();
      }
    } catch {
      /* not JSON — use raw text */
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * One generateContent call with backoff on 429/5xx. Returns the joined text of
 * the first candidate. Throws on a hard failure (caller decides the fallback) —
 * we never silently return empty, so a broken key/quota surfaces instead of
 * masquerading as "the model had nothing to say".
 */
export async function generateText(prompt: string, opts: GenerateOpts = {}): Promise<string> {
  // Prefer the user's Make scenario (central model control) when configured;
  // fall back to the in-code Gemini call below if it yields nothing.
  const viaMake = await generateViaMake(prompt, opts);
  if (viaMake) return viaMake;

  const model = opts.model ?? MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
      ...(opts.thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } }
        : {})
    }
  };
  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }

  let lastErr = '';
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const j = await res.json();
        const parts = j?.candidates?.[0]?.content?.parts ?? [];
        const text = parts
          .map((p: { text?: string }) => (typeof p.text === 'string' ? p.text : ''))
          .join('')
          .trim();
        if (text) return text;
        // Blocked / empty candidate → report rather than pretend.
        lastErr = `empty candidate (finish: ${j?.candidates?.[0]?.finishReason ?? '?'}, block: ${j?.promptFeedback?.blockReason ?? 'none'})`;
      } else {
        lastErr = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) {
          throw new Error(`${lastErr}: ${(await res.text()).slice(0, 200)}`);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'fetch error';
      lastErr = msg;
      if (!/HTTP (429|5\d\d)/.test(msg) && !/fetch|network|timeout/i.test(msg)) throw e;
    }
    await sleep(500 * 2 ** attempt); // 0.5, 1, 2, 4s
  }
  throw new Error(`generateText failed after ${MAX_RETRY} attempts: ${lastErr}`);
}

/** Parse a JSON object out of model output, tolerating ```json fences / stray prose. */
export function parseJsonObject<T = Record<string, unknown>>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // last resort: grab the outermost {...}
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1)) as T;
      } catch {
        /* give up */
      }
    }
    return null;
  }
}
