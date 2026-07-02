import 'server-only';

// Long-relay fetch for Make webhook calls that can run past undici's DEFAULT
// ~300s headers/body timeout (Node's global fetch). A long opine run MEASURED
// 5min in Make and completed successfully — while the relay's global fetch
// threw at ~300s, so the route returned "temporarily unavailable" for an
// answer that actually finished. Same trap this repo already hit on Whisper
// (see /api/transcribe). MATCHED-SET RULE: undici's OWN fetch with undici's
// OWN Agent — a standalone-undici Agent on Node's global fetch throws
// UND_ERR_INVALID_ARG.
const LONG_TIMEOUT_MS = 780_000; // just under the 800s Fluid maxDuration

export async function longFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<Response> {
  const { Agent, fetch: undiciFetch } = await import('undici');
  return undiciFetch(url, {
    ...init,
    dispatcher: new Agent({
      headersTimeout: LONG_TIMEOUT_MS,
      bodyTimeout: LONG_TIMEOUT_MS
    })
  } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
}

/** True when the relay itself timed out waiting on Make (vs Make erroring). */
export function isRelayTimeout(e: unknown): boolean {
  const err = e as { code?: string; name?: string; cause?: { code?: string } };
  const code = err?.code ?? err?.cause?.code;
  return (
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT' ||
    err?.name === 'TimeoutError'
  );
}
