import { auth } from '@clerk/nextjs/server';

// Speech-to-text proxy → Microsoft MAI-Transcribe-1.5 (Foundry LLM Speech API).
// Contract per learn.microsoft.com/.../mai-transcribe (api-version 2025-10-15):
//   POST {resource}.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe
//   header  Ocp-Apim-Subscription-Key: <key>
//   body    multipart/form-data: audio=@file  +  definition={...JSON}
//   audio   WAV / MP3 / FLAC, < 300 MB
// `phraseList.phrases` = entity biasing (we pass the brain's wired source names).
// NOTE: MAI-Transcribe is in public preview.

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = process.env.MAI_TRANSCRIBE_API_KEY;
  const endpoint = process.env.MAI_TRANSCRIBE_ENDPOINT;
  if (!key || !endpoint) {
    return Response.json(
      {
        error:
          'Transcription not configured — set MAI_TRANSCRIBE_API_KEY and MAI_TRANSCRIBE_ENDPOINT (Foundry Speech resource).'
      },
      { status: 503 }
    );
  }

  const inForm = await req.formData();
  const audio = inForm.get('audio');
  if (!(audio instanceof File)) {
    return Response.json({ error: 'audio file is required' }, { status: 400 });
  }
  // A bare WAV header is 44 bytes — anything near that captured no audio (mic
  // permission race, AudioContext suspended, or a tap-too-fast recording).
  if (audio.size < 2048) {
    return Response.json(
      {
        error:
          'That recording was empty — no audio was captured. Check the mic is allowed, then hold the recording a moment longer.'
      },
      { status: 400 }
    );
  }

  let phrases: string[] = [];
  const raw = inForm.get('phrases');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) phrases = parsed.filter((p) => typeof p === 'string');
    } catch {
      /* ignore malformed phrase list */
    }
  }

  const model = process.env.MAI_TRANSCRIBE_MODEL ?? 'mai-transcribe-1.5';
  // The Foundry fast-transcription envelope requires `locales`; omitting it is a
  // common cause of a 400. Default en-US; override via MAI_TRANSCRIBE_LOCALES
  // (comma-separated, e.g. "en-US,es-ES").
  const locales = (process.env.MAI_TRANSCRIBE_LOCALES ?? 'en-US')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const definition: Record<string, unknown> = {
    locales,
    enhancedMode: { enabled: true, model }
  };
  // phraseList only supported on mai-transcribe-1.5. Azure rejects (400) any
  // context keyword longer than 50 chars — our source names (YouTube titles,
  // long doc names) routinely exceed that — so trim each to 50, drop empties,
  // de-dupe, and cap at 50 entries.
  if (phrases.length && model === 'mai-transcribe-1.5') {
    const cleaned = Array.from(
      new Set(phrases.map((p) => p.trim().slice(0, 50)).filter(Boolean))
    ).slice(0, 50);
    if (cleaned.length) definition.phraseList = { phrases: cleaned };
  }

  const apiVersion = process.env.MAI_TRANSCRIBE_API_VERSION ?? '2025-10-15';
  const url = endpoint.includes('transcriptions:transcribe')
    ? endpoint
    : `${endpoint.replace(/\/$/, '')}/speechtotext/transcriptions:transcribe?api-version=${apiVersion}`;

  const outForm = new FormData();
  outForm.append('audio', audio, audio.name || 'audio.wav');
  outForm.append('definition', JSON.stringify(definition));

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': key }, // fetch sets multipart boundary
      body: outForm
    });
  } catch {
    return Response.json({ error: 'Could not reach transcription service' }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Surface Azure's actual reason in the message (not just the status) so the
    // client alert tells us WHY — a bare "returned 400" hides the real cause.
    const trimmed = detail.replace(/\s+/g, ' ').trim().slice(0, 240);
    console.error(`[transcribe] upstream ${res.status}: ${trimmed}`);
    return Response.json(
      {
        error: trimmed
          ? `Transcription service returned ${res.status}: ${trimmed}`
          : `Transcription service returned ${res.status}`,
        detail: trimmed
      },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  // Fast-transcription shape is combinedPhrases[].text; stay defensive.
  const text =
    (Array.isArray(data.combinedPhrases)
      ? data.combinedPhrases.map((p: { text?: string }) => p.text).filter(Boolean).join(' ')
      : '') ||
    data.text ||
    data.displayText ||
    '';

  return Response.json({ text });
}
