/**
 * PDF extraction via OpenRouter `google/gemini-2.5-flash-lite`.
 *
 * Cheap, multilingual, handles Hebrew transfer slips cleanly per Phase 4
 * end-to-end on the Shaul DM.
 *
 * Filenames with spaces/parens trip OpenRouter's parser plugin — we sanitize.
 */

import type { ExtractionInput, ExtractionResult, ExtractorContext } from './types';
import { postChatCompletion } from './openrouter';

export const PDF_DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
export const PDF_EXTRACTOR_VERSION = '2026-05-04';

const PROMPT =
  'Extract all text from this PDF verbatim, preserving structure (headings, ' +
  'lists, tables as markdown tables when possible). Output ONLY the extracted ' +
  'text. Use page separators of the form `\\n\\n--- page N ---\\n\\n` between pages.';

export async function extractPdf(
  input: ExtractionInput,
  ctx: ExtractorContext,
): Promise<ExtractionResult> {
  if (!ctx.openrouterApiKey) throw new Error('OPENROUTER_API_KEY required for pdf extractor');

  const model = ctx.modelOverride ?? PDF_DEFAULT_MODEL;
  const dataUrl = `data:application/pdf;base64,${input.buf.toString('base64')}`;
  const safeName = input.filename.replace(/[^A-Za-z0-9._-]/g, '_');

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
            { type: 'file', file: { filename: safeName, file_data: dataUrl } },
          ],
        },
      ],
    },
  });
  const wallMs = Date.now() - t0;

  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('empty extraction');

  // Best-effort split on page markers
  const segments: ExtractionResult['segments'] = [];
  const pageRe = /\n\n---\s*page\s*(\d+)\s*---\n\n/gi;
  if (pageRe.test(text)) {
    pageRe.lastIndex = 0;
    const parts = text.split(pageRe);
    if (parts[0]?.trim()) {
      segments.push({ start: null, end: null, page: 1, text: parts[0]!.trim() });
    }
    for (let i = 1; i < parts.length; i += 2) {
      const pg = Number(parts[i]);
      const content = parts[i + 1]?.trim();
      if (content) segments.push({ start: null, end: null, page: pg, text: content });
    }
  }

  return {
    kind: 'doc_text',
    text,
    language: null,
    duration_s: null,
    segments,
    extractor: model,
    version: PDF_EXTRACTOR_VERSION,
    is_deterministic: false,
    metrics: {
      wall_ms: wallMs,
      chars: text.length,
      n_pages_detected: segments.length || 1,
      model_used: data.model ?? model,
      provider: data.provider ?? 'openrouter',
      generation_id: data.id ?? '',
      usage: data.usage ?? null,
    },
    warnings: [],
  };
}
