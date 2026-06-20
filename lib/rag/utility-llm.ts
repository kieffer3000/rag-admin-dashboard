// Single gateway for the small RAG "utility" LLM calls (query contextualize,
// corrective reformulate, rolling + document/cluster summarize). EVERY model
// call goes through the Make.com "rag-llm-utility" scenario ({ prompt } →
// { result }) so the model version is managed in ONE place (the Make UI) and
// the app never calls an LLM directly. If the webhook isn't configured the
// caller gets null and degrades gracefully (no summary / query unchanged) —
// there is intentionally NO internal/direct model fallback.

export async function runUtilityLLM(
  prompt: string,
  // Kept for signature compatibility; output length etc. is configured on the
  // Make scenario's model module, not here (the webhook only receives `prompt`).
  _opts?: { maxOutputTokens?: number; temperature?: number }
): Promise<string | null> {
  const webhook = process.env.MAKE_UTILITY_WEBHOOK_URL;
  if (!webhook) return null;

  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!r.ok) return null;
    const raw = (await r.text()).trim();
    // 'Accepted' = Make queued the call (scenario busy/off) — not a result.
    if (!raw || raw === 'Accepted') return null;
    // Accept raw text, or unwrap a single-string JSON value if the model
    // returned JSON (e.g. {"result":…} / {"query":…} / {"text":…}).
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object') {
        const v = j.result ?? j.query ?? j.text ?? j.answer ?? j.output;
        if (typeof v === 'string' && v.trim()) return v.trim();
        const vals = Object.values(j);
        if (vals.length === 1 && typeof vals[0] === 'string' && vals[0].trim())
          return (vals[0] as string).trim();
      }
    } catch {
      /* not JSON — use the raw text */
    }
    return raw;
  } catch {
    return null;
  }
}
