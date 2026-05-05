/**
 * Free, deterministic, local extractors — DOCX, XLSX, HTML, MD, JSON, plain text.
 *
 * No network, no LLM, no fees. Same input → same output, every time.
 */

import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

import type { ExtractionInput, ExtractionResult } from './types';

export async function extractDocx(input: ExtractionInput): Promise<ExtractionResult> {
  const r = await mammoth.extractRawText({ buffer: input.buf });
  return {
    kind: 'doc_text',
    text: r.value,
    language: null,
    duration_s: null,
    segments: [],
    extractor: 'mammoth-extractRawText',
    version: '1.0.0',
    is_deterministic: true,
    metrics: { chars: r.value.length, mammoth_messages: r.messages.length },
    warnings: r.messages.map((m) => `${m.type}: ${m.message}`),
  };
}

export function extractXlsx(input: ExtractionInput): ExtractionResult {
  const wb = XLSX.read(input.buf, { type: 'buffer' });
  const parts: string[] = [];
  let totalRows = 0;
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]!;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`### Sheet: ${name}\n\n${csv}`);
    totalRows += csv.split('\n').length;
  }
  const text = parts.join('\n\n---\n\n');
  return {
    kind: 'doc_text',
    text,
    language: null,
    duration_s: null,
    segments: [],
    extractor: 'sheetjs-sheet_to_csv',
    version: '0.18.5',
    is_deterministic: true,
    metrics: { chars: text.length, sheets: wb.SheetNames.length, total_rows: totalRows },
    warnings: [],
  };
}

export function extractHtml(input: ExtractionInput): ExtractionResult {
  const html = input.buf.toString('utf-8');
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    kind: 'doc_text',
    text: stripped,
    language: null,
    duration_s: null,
    segments: [],
    extractor: 'regex-strip-html',
    version: '1.0.0',
    is_deterministic: true,
    metrics: { chars: stripped.length, raw_chars: html.length },
    warnings: [],
  };
}

export function extractMarkdown(input: ExtractionInput): ExtractionResult {
  const text = input.buf.toString('utf-8');
  return {
    kind: 'doc_text',
    text,
    language: null,
    duration_s: null,
    segments: [],
    extractor: 'markdown-identity',
    version: '1.0.0',
    is_deterministic: true,
    metrics: { chars: text.length },
    warnings: [],
  };
}

export function extractPlainText(input: ExtractionInput): ExtractionResult {
  const text = input.buf.toString('utf-8');
  return {
    kind: 'doc_text',
    text,
    language: null,
    duration_s: null,
    segments: [],
    extractor: 'plain-text-identity',
    version: '1.0.0',
    is_deterministic: true,
    metrics: { chars: text.length },
    warnings: [],
  };
}

export function extractJson(input: ExtractionInput): ExtractionResult {
  const raw = input.buf.toString('utf-8');
  try {
    const parsed = JSON.parse(raw);
    const pretty = JSON.stringify(parsed, null, 2);
    return {
      kind: 'doc_text',
      text: pretty,
      language: null,
      duration_s: null,
      segments: [],
      extractor: 'json-pretty',
      version: '1.0.0',
      is_deterministic: true,
      metrics: { chars: pretty.length, valid: true },
      warnings: [],
    };
  } catch (err) {
    return {
      kind: 'doc_text',
      text: raw,
      language: null,
      duration_s: null,
      segments: [],
      extractor: 'json-raw',
      version: '1.0.0',
      is_deterministic: true,
      metrics: { chars: raw.length, valid: false },
      warnings: [`json parse failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
