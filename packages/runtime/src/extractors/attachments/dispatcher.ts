/**
 * Single-entry dispatcher for attachment extraction.
 *
 * mime/extension → handler:
 *   audio/*                                  → whisper-large-v3-turbo (OpenRouter)
 *   image/*                                  → gemini-3.1-flash-lite-preview (OpenRouter)
 *   application/pdf                          → gemini-2.5-flash-lite (OpenRouter)
 *   application/vnd.openxmlformats-…wordprocessingml → mammoth (in-process)
 *   application/vnd.openxmlformats-…spreadsheetml    → sheetjs (in-process)
 *   text/html                                → regex strip (in-process)
 *   text/markdown                            → identity (in-process)
 *   application/json                         → JSON pretty (in-process)
 *   text/*                                   → identity (in-process)
 *   else                                     → null (skip — zip, video, binary)
 *
 * Returns null when the mime/extension is unsupported. Caller treats null as
 * "skip" rather than "fail."
 */

import type { ExtractionInput, ExtractionResult, ExtractorContext } from './types';
import { extractAudio } from './audio';
import { extractPdf } from './pdf';
import { extractImage } from './image';
import {
  extractDocx,
  extractXlsx,
  extractHtml,
  extractMarkdown,
  extractPlainText,
  extractJson,
} from './inProcess';

export async function dispatchExtract(
  input: ExtractionInput,
  ctx: ExtractorContext,
): Promise<ExtractionResult | null> {
  const lower = input.filename.toLowerCase();
  const mime = input.mime.toLowerCase();

  // ── LLM-routed (network) ──
  if (mime.startsWith('audio/') || /\.(opus|ogg|mp3|wav|m4a|flac|aac)$/.test(lower)) {
    return extractAudio(input, ctx);
  }
  if (mime.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/.test(lower)) {
    return extractImage(input, ctx);
  }
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    return extractPdf(input, ctx);
  }

  // ── In-process (free, deterministic) ──
  if (lower.endsWith('.docx') || mime.includes('wordprocessingml')) {
    return extractDocx(input);
  }
  if (lower.endsWith('.xlsx') || mime.includes('spreadsheetml')) {
    return extractXlsx(input);
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm') || mime.startsWith('text/html')) {
    return extractHtml(input);
  }
  if (lower.endsWith('.md') || mime === 'text/markdown') {
    return extractMarkdown(input);
  }
  if (lower.endsWith('.json') || mime === 'application/json') {
    return extractJson(input);
  }
  if (lower.endsWith('.txt') || mime.startsWith('text/')) {
    return extractPlainText(input);
  }

  // ── Skip ── (zip, video, octet-stream, etc)
  return null;
}

export * from './types';
export {
  AUDIO_DEFAULT_MODEL,
  AUDIO_EXTRACTOR_VERSION,
} from './audio';
export {
  PDF_DEFAULT_MODEL,
  PDF_EXTRACTOR_VERSION,
} from './pdf';
export {
  IMAGE_DEFAULT_MODEL,
  IMAGE_EXTRACTOR_VERSION,
} from './image';
