import { auth } from '@clerk/nextjs/server';

// Speech-to-text for the Board: push-to-talk question dictation (Tier 2)
// and voice-memos-as-sources (Tier 3, Scenario A v2).
//
// Target model: Microsoft MAI-Transcribe-1.5 via the Foundry API
// (43 languages, 2.4% WER, keyword biasing — bias toward wired source
// names at call time). SCAFFOLD ONLY until the Foundry account exists:
// the exact request shape gets wired against the official cookbook docs
// once MAI_TRANSCRIBE_API_KEY is configured — not guessed from memory.

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.MAI_TRANSCRIBE_API_KEY;
  const endpoint = process.env.MAI_TRANSCRIBE_ENDPOINT;
  if (!apiKey || !endpoint) {
    return Response.json(
      {
        error:
          'Transcription not configured — set MAI_TRANSCRIBE_API_KEY and MAI_TRANSCRIBE_ENDPOINT (Foundry).'
      },
      { status: 503 }
    );
  }

  // TODO(foundry): multipart audio upload + keyword biasing per the
  // MAI-Transcribe cookbook. Wired when the key lands.
  return Response.json(
    { error: 'Foundry call not yet wired — pending account setup.' },
    { status: 501 }
  );
}
