import 'server-only';

// Dedicated audio transcription via the Make CloudConvert→Whisper route
// (MAKE_TRANSCRIBE_WEBHOOK_URL). Transcription is a MECHANICAL job — it must NOT
// ride an LLM inline. There is deliberately NO inline fallback: if the route is
// unconfigured we error clearly rather than silently transcribing with a model.
//
// The Make scenario compresses (m4a@16k → a full 3h fits one Whisper call),
// rejects audio over 3h with a clear message, and returns the transcript as the
// plain-text body. On rejection it returns JSON { ok:false, error } — which we
// surface verbatim so the user sees "...over 3:00:00 — the audio upload limit is
// 3 hours."

const THREE_HOUR_HINT = 'audio upload limit is 3 hours';

/** Transcribe an audio file. Returns the transcript text, or throws with a
 *  user-facing message (e.g. the 3-hour cap) the caller can show as-is. */
export async function transcribeViaMake(
  bytes: Uint8Array,
  filename: string,
  mime: string
): Promise<string> {
  const url = process.env.MAKE_TRANSCRIBE_WEBHOOK_URL;
  if (!url) {
    throw new Error(
      'Transcription is not configured (MAKE_TRANSCRIBE_WEBHOOK_URL unset). Audio is no longer transcribed inline.'
    );
  }

  const fd = new FormData();
  fd.append('kind', 'audio');
  fd.append('file', new Blob([bytes], { type: mime || 'audio/mpeg' }), filename || 'audio.m4a');

  const res = await fetch(url, { method: 'POST', body: fd });
  const raw = await res.text();

  // Reject path → JSON { ok:false, error }. Happy path → plain-text transcript.
  let parsed: { ok?: boolean; error?: string; note?: string; transcript?: string } | null = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* plain-text transcript body */
  }

  if (!res.ok) {
    throw new Error(parsed?.error ?? parsed?.note ?? `Transcription failed (${res.status}).`);
  }
  if (parsed && parsed.ok === false) {
    throw new Error(parsed.error ?? parsed.note ?? `Transcription rejected (${THREE_HOUR_HINT}).`);
  }

  const transcript = (parsed?.transcript ?? raw).trim();
  if (!transcript) throw new Error('Transcription returned no text.');
  return transcript;
}
