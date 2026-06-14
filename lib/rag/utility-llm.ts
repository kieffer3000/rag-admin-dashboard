// Single gateway for the small RAG "utility" LLM calls (query contextualize,
// corrective reformulate, rolling summarize). It PREFERS a Make.com webhook
// ("rag-llm-utility": { prompt } → { result }) so the model version is managed
// in the Make UI and never silently drifts. If the webhook isn't configured it
// falls back to a direct Gemini call (RAG_UTILITY_MODEL — a single env var, the
// only model reference left in code, used only as a pre-wiring safety net).

export async function runUtilityLLM(
  prompt: string,
  opts?: { maxOutputTokens?: number; temperature?: number }
): Promise<string | null> {
  const webhook = process.env.MAKE_UTILITY_WEBHOOK_URL;
  if (webhook) {
    try {
      const r = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      if (r.ok) {
        // Accept either a raw-text body (Make response body = {{2.result}}) or
        // a JSON { result } wrapper — whichever the scenario is set up to return.
        const raw = (await r.text()).trim();
        if (raw) {
          try {
            const j = JSON.parse(raw);
            if (typeof j?.result === 'string' && j.result.trim()) return j.result.trim();
          } catch {
            /* not JSON — use the raw text */
          }
          return raw;
        }
      }
    } catch {
      /* fall through to the direct fallback */
    }
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.RAG_UTILITY_MODEL ?? 'gemini-2.5-flash';
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: opts?.temperature ?? 0.3,
            maxOutputTokens: opts?.maxOutputTokens ?? 300
          }
        })
      }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const text: string =
      j?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p?.text ?? '')
        .join('') ?? '';
    return text.trim() || null;
  } catch {
    return null;
  }
}
