/**
 * Image extraction (Phase 5) via OpenRouter `google/gemini-3.1-flash-lite-preview`.
 *
 * Why this model: native multimodal (text + image + audio + video + file),
 * 1M context, $0.25/M image tokens, structured outputs supported. Same model
 * we'll use for image input so the cache + ops surface stays unified.
 *
 * Output:
 *   text  = OCR'd text + 1-paragraph visual description
 *   segments = one per detected region (chart / table / text-block / face) when present
 *   language = detected from any text in the image
 */

import type { ExtractionInput, ExtractionResult, ExtractorContext } from './types';
import { postChatCompletion } from './openrouter';

export const IMAGE_DEFAULT_MODEL = 'google/gemini-3.1-flash-lite-preview';
export const IMAGE_EXTRACTOR_VERSION = '2026-05-04';

const PROMPT =
  'Examine this image. Output JSON with exactly these fields:\n' +
  '  "ocr_text": all text visible in the image, verbatim, in reading order. Empty string if none.\n' +
  '  "description": one paragraph describing the visual content (what it shows, layout, key elements).\n' +
  '  "language": ISO 639-1 code of the dominant text language ("en", "he", etc), or null if no text.\n' +
  '  "regions": array of detected meaningful regions, each {\"kind\":\"chart|table|text_block|face|other\", \"text\":\"...\"}.\n' +
  'Output JSON only — no preface, no commentary, no fenced code blocks.';

interface ImageJsonResult {
  ocr_text?: string;
  description?: string;
  language?: string | null;
  regions?: Array<{ kind?: string; text?: string }>;
}

function inferImageMime(filename: string, declaredMime: string): string {
  if (declaredMime.startsWith('image/')) return declaredMime;
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

export async function extractImage(
  input: ExtractionInput,
  ctx: ExtractorContext,
): Promise<ExtractionResult> {
  if (!ctx.openrouterApiKey) throw new Error('OPENROUTER_API_KEY required for image extractor');

  const model = ctx.modelOverride ?? IMAGE_DEFAULT_MODEL;
  const mime = inferImageMime(input.filename, input.mime);
  const dataUrl = `data:${mime};base64,${input.buf.toString('base64')}`;

  const t0 = Date.now();
  const data = await postChatCompletion({
    apiKey: ctx.openrouterApiKey,
    model,
    body: {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      // keep reasoning minimal — this is structured extraction, not analysis
      reasoning: { effort: 'minimal' },
    },
  });
  const wallMs = Date.now() - t0;

  const raw = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!raw) throw new Error('empty extraction');

  let parsed: ImageJsonResult;
  try {
    parsed = JSON.parse(raw) as ImageJsonResult;
  } catch (err) {
    // Model occasionally fences the JSON — strip ```json ... ``` and retry once
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    parsed = JSON.parse(stripped) as ImageJsonResult;
  }

  const ocr = (parsed.ocr_text ?? '').trim();
  const desc = (parsed.description ?? '').trim();
  const text = ocr ? `${ocr}\n\n[visual] ${desc}` : `[visual] ${desc}`;

  const segments = (parsed.regions ?? [])
    .filter((r) => (r.text ?? '').trim().length > 0)
    .map((r, i) => ({
      start: i,
      end: i + 1,
      page: null,
      text: `[${r.kind ?? 'region'}] ${r.text}`,
    }));

  return {
    kind: 'image_caption',
    text,
    language: parsed.language ?? null,
    duration_s: null,
    segments,
    extractor: model,
    version: IMAGE_EXTRACTOR_VERSION,
    is_deterministic: false,
    metrics: {
      wall_ms: wallMs,
      chars: text.length,
      ocr_chars: ocr.length,
      desc_chars: desc.length,
      n_regions: segments.length,
      model_used: data.model ?? model,
      provider: data.provider ?? 'openrouter',
      generation_id: data.id ?? '',
      usage: data.usage ?? null,
    },
    warnings: [],
  };
}
