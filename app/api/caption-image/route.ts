// app/api/caption-image/route.ts
//
// THOROUGH image captioner for the knowledge-base image DB. Runs Amazon Nova
// Lite v1 (Bedrock, multimodal) via the AWS SDK ConverseCommand — the same proven
// pattern CaraComp uses in /api/prevalidate-image. Nova Lite is the cheapest
// vision model (~$0.0002/thorough-image vs ~$0.0063 on gemini-3.5-flash).
//
// Why backend (not Make): the Make Bedrock module is TEXT-ONLY — image content
// blocks only exist in the AWS SDK Converse call. This is a single deterministic
// describe-call, not a reasoning agent.
//
// Returns a rich, search-optimized JSON description: a paragraph caption (embed
// THIS for semantic image search), verbatim OCR of any text, and structured
// entities/tags for metadata filtering.
//
// Requires: @aws-sdk/client-bedrock-runtime, AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY,
// AWS_REGION (us-east-1), and bedrock:InvokeModel on amazon.nova-lite-v1:0.

import { NextRequest, NextResponse } from 'next/server';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL_ID = process.env.CAPTION_MODEL_ID ?? 'amazon.nova-lite-v1:0';

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
  }
});

// Exhaustive describe rubric — the goal is RETRIEVAL: anything a user might later
// search for must be named here. Privacy: describe appearance/clothing/activity,
// but NEVER assert a real person's identity or make biometric identity claims.
const SYSTEM_PROMPT = `You are a meticulous visual cataloguer building a searchable image database. For the image given, produce an EXHAUSTIVE, factual description so the image can be found later by anyone searching for anything visible in it. Describe ONLY what is actually visible — never guess, never invent, never identify a specific real person by name.

Cover ALL of the following that apply:
- MEDIUM / TYPE: photograph, screenshot, UI, diagram, chart/graph, illustration, painting, scanned document, map, meme, etc.
- PEOPLE: how many; for each, apparent age range, gender presentation, clothing and colours, hairstyle, posture, facial expression, gaze direction, and what they are doing. Describe appearance only — do NOT name or claim identity.
- ANIMALS / OBJECTS: species or type, count, colour, condition, brand/logo if legible.
- SETTING & SCENE: indoor/outdoor, location type, background, foreground, time of day, weather, season.
- TEXT (OCR): transcribe ALL legible text VERBATIM — signage, labels, captions, UI text, headings, watermarks, document body. If it is a chart/graph, state the chart type, axes, series, and the key values/trend.
- COMPOSITION: dominant and accent colours, lighting, framing, perspective, style/mood.
- NOTABLE DETAILS: anything distinctive, unusual, or likely to be searched.

Return ONLY a JSON object with exactly these keys:
{
  "caption": string,        // 3-6 rich sentences weaving the above into a natural, detailed description optimised for semantic search
  "image_type": string,     // one short label from the MEDIUM list above
  "ocr_text": string,       // ALL visible text transcribed verbatim; "" if none
  "subjects": string[],     // people/animals as short phrases ("man in red jacket", "golden retriever")
  "objects": string[],      // notable objects/brands
  "setting": string,        // one short phrase for the scene/environment
  "colors": string[],       // dominant colours
  "tags": string[]          // 8-20 lowercase keywords someone might search
}
No markdown, no code fences, no commentary — JSON only.`;

type Caption = {
  caption: string;
  image_type: string;
  ocr_text: string;
  subjects: string[];
  objects: string[];
  setting: string;
  colors: string[];
  tags: string[];
};

function detectFormat(mime?: string): 'jpeg' | 'png' | 'webp' | 'gif' {
  if (!mime) return 'jpeg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpeg';
}

export async function POST(req: NextRequest) {
  try {
    // Clerk-exempt route (Make calls it server-to-server) → enforce a shared
    // secret. If CAPTION_WEBHOOK_SECRET is set, the caller MUST present it.
    const secret = process.env.CAPTION_WEBHOOK_SECRET;
    if (secret && req.headers.get('x-caption-secret') !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));

    // Accept a URL (fetch it), a data URL, or raw base64 + mimeType.
    let bytes: Uint8Array | null = null;
    let mime: string | undefined = body.mimeType;

    const imageUrl: string | undefined = body.image_url ?? body.imageUrl ?? body.url;
    const inline: string | undefined = body.image ?? body.imageBase64;

    if (typeof inline === 'string' && inline) {
      const dataUrl = inline.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
      const b64 = dataUrl ? dataUrl[2] : inline;
      if (dataUrl) mime = dataUrl[1];
      bytes = Buffer.from(b64, 'base64');
    } else if (typeof imageUrl === 'string' && imageUrl) {
      const r = await fetch(imageUrl, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) {
        return NextResponse.json({ error: `Could not fetch image (HTTP ${r.status}).` }, { status: 200 });
      }
      mime = mime ?? r.headers.get('content-type') ?? 'image/jpeg';
      bytes = new Uint8Array(await r.arrayBuffer());
    }

    if (!bytes || bytes.byteLength === 0) {
      return NextResponse.json({ error: 'Provide image_url or image (base64/dataURL).' }, { status: 400 });
    }

    const command = new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages: [
        {
          role: 'user',
          content: [
            { image: { format: detectFormat(mime), source: { bytes } } },
            { text: 'Catalogue this image. Return ONLY the JSON object.' }
          ]
        }
      ],
      // Room for a thorough description + full OCR; temp low for faithful detail.
      inferenceConfig: { maxTokens: 900, temperature: 0.2 }
    });

    const resp = await bedrock.send(command);
    const text = resp.output?.message?.content?.find((c) => 'text' in c)?.text ?? '{}';

    let parsed: Partial<Caption>;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      // Model returned prose instead of JSON → still usable as the caption.
      parsed = { caption: text.trim() };
    }

    const result: Caption = {
      caption: parsed.caption ?? '',
      image_type: parsed.image_type ?? '',
      ocr_text: parsed.ocr_text ?? '',
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
      objects: Array.isArray(parsed.objects) ? parsed.objects : [],
      setting: parsed.setting ?? '',
      colors: Array.isArray(parsed.colors) ? parsed.colors : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : []
    };

    // `embed_text` is what the ingest flow should EMBED — caption + OCR + tags fused
    // so search hits on description, on words inside the image, and on keywords.
    const embed_text = [result.caption, result.ocr_text, result.tags.join(', ')]
      .filter((s) => s && s.trim())
      .join('\n');

    return NextResponse.json({ ...result, embed_text }, { status: 200 });
  } catch (err: any) {
    console.error('[caption-image] error:', err);
    return NextResponse.json(
      { error: err?.message ?? 'Captioning failed.' },
      { status: 502 }
    );
  }
}
