/**
 * Extractor catalog — single TS source of truth for `extractor_metadata`.
 *
 * Mirrors the rows in `public.extractor_metadata`. The DB table is the
 * queryable surface; this module is the editable surface — when you add
 * an extractor, edit it here, then run `scripts/sync-extractor-metadata.ts`
 * to push to Supabase.
 *
 * Lookup keys match `extractor_metadata.id` exactly:
 *   - Production:  `<extractor>@<version>` (matches l1_extraction_runs.extractor + version)
 *   - Candidates:  `<provider>:<family>:<facet>@<date>` (no run rows yet)
 */

export type ExtractorFamily =
  | 'attachment' | 'meeting' | 'whatsapp' | 'session_log' | 'synthesis' | 'evaluation';

export type ExtractorFacet =
  | 'transcription' | 'transcription_diarization_bundled' | 'diarization'
  | 'image_caption' | 'doc_chunks' | 'doc_text' | 'tabular_csv' | 'plain_text'
  | 'turn_text' | 'tool_calls' | 'messages' | 'day_l2' | 'wer_cer_benchmark';

export type ExtractorIntendedStatus =
  | 'active' | 'candidate' | 'deprecated' | 'experiment';

export type ExtractorProvider =
  | 'in-process' | 'openrouter' | 'anthropic' | 'assemblyai' | 'xai'
  | 'elevenlabs' | 'pyannoteai' | 'multi';

export interface PricingModel {
  unit:
    | 'audio_second' | 'audio_hour_bundled' | 'audio_hour_diarization_only'
    | 'input_token' | 'output_token' | 'in_process' | 'input_token + output_token';
  approx_usd_per_hour?: number;
  approx_usd_per_image?: number;
  approx_usd_per_page?: number;
  approx_usd_per_meeting?: number;
  approx_usd_per_synthesis?: number;
  currency_native?: string;
  breakdown?: Record<string, number>;
}

export interface BenchmarkData {
  audio?: string;
  wer?: number;
  cer?: number;
  speaker_share_drift_pp?: number[];
  wall_seconds_for_41_min?: number;
  chunks?: number;
  validated?: string;        // ISO date
  notes?: string;
}

export interface CatalogEntry {
  id: string;
  family: ExtractorFamily;
  facet: ExtractorFacet;
  source_types: string[];
  intended_status: ExtractorIntendedStatus;
  provider: ExtractorProvider;
  pricing_model: PricingModel;
  benchmark_data?: BenchmarkData;
  notes: string;
  superseded_by?: string;
}

export const CATALOG: CatalogEntry[] = [
  // ─── Active production extractors ────────────────────────────────
  {
    id: 'openai/whisper-large-v3-turbo@2026-05-04',
    family: 'attachment', facet: 'transcription',
    source_types: ['whatsapp_message', 'whatsapp_message_live'],
    intended_status: 'active', provider: 'openrouter',
    pricing_model: { unit: 'audio_second', approx_usd_per_hour: 0.07 },
    notes: "WhatsApp voice notes — single-file, opus→wav transcode",
  },
  {
    id: 'openai/whisper-large-v3-turbo@2026-05-05',
    family: 'meeting', facet: 'transcription',
    source_types: ['meeting_audio'],
    intended_status: 'active', provider: 'openrouter',
    pricing_model: { unit: 'audio_second', approx_usd_per_hour: 0.07 },
    notes: "Long-form audio chunked at 10-min via ffmpeg + bias prompt (today's shipping)",
  },
  {
    id: 'google/gemini-3.1-flash-lite-preview@2026-05-04',
    family: 'attachment', facet: 'image_caption',
    source_types: ['whatsapp_message', 'whatsapp_message_live'],
    intended_status: 'active', provider: 'openrouter',
    pricing_model: { unit: 'input_token', approx_usd_per_image: 0.0005 },
    notes: 'Image → caption + OCR text',
  },
  {
    id: 'google/gemini-2.5-flash-lite@2026-05-04',
    family: 'attachment', facet: 'doc_chunks',
    source_types: ['pdf_upload', 'whatsapp_message'],
    intended_status: 'active', provider: 'openrouter',
    pricing_model: { unit: 'input_token', approx_usd_per_page: 0.0008 },
    notes: 'PDF → per-page text via vision',
  },
  {
    id: 'mammoth-extractRawText@1.10.0',
    family: 'attachment', facet: 'doc_text',
    source_types: ['whatsapp_message'],
    intended_status: 'active', provider: 'in-process',
    pricing_model: { unit: 'in_process' },
    notes: 'DOCX → plain text. Library version pinned.',
  },
  {
    id: 'sheetjs-sheet_to_csv@0.18.5',
    family: 'attachment', facet: 'tabular_csv',
    source_types: ['whatsapp_message'],
    intended_status: 'active', provider: 'in-process',
    pricing_model: { unit: 'in_process' },
    notes: 'XLSX → CSV via sheetjs',
  },
  {
    id: 'regex-strip-html@1.0.0',
    family: 'attachment', facet: 'plain_text',
    source_types: ['whatsapp_message'],
    intended_status: 'active', provider: 'in-process',
    pricing_model: { unit: 'in_process' },
    notes: 'HTML → plain text via tag-stripping regex',
  },
  {
    id: 'markdown-identity@1.0.0',
    family: 'attachment', facet: 'plain_text',
    source_types: ['whatsapp_message'],
    intended_status: 'active', provider: 'in-process',
    pricing_model: { unit: 'in_process' },
    notes: 'Markdown preserved as-is',
  },
  {
    id: 'json-pretty@2026-05-04',
    family: 'attachment', facet: 'doc_text',
    source_types: ['whatsapp_message'],
    intended_status: 'active', provider: 'in-process',
    pricing_model: { unit: 'in_process' },
    notes: 'JSON → 2-space pretty-printed',
  },
  {
    id: 'jsonl-turns-v1@0.1.0',
    family: 'session_log', facet: 'turn_text',
    source_types: ['claude_code_jsonl', 'cursor_jsonl'],
    intended_status: 'active', provider: 'in-process',
    pricing_model: { unit: 'in_process' },
    notes: 'Walks JSONL session, emits one l1_event per turn',
  },
  {
    id: 'whatsapp-text-parser@v1',
    family: 'whatsapp', facet: 'messages',
    source_types: ['whatsapp_zip'],
    intended_status: 'active', provider: 'in-process',
    pricing_model: { unit: 'in_process' },
    notes: 'Highest-volume extractor. _chat.txt → l0_artifact + l1_event per line',
  },
  {
    id: 'gowa-webhook-handler@1.0',
    family: 'whatsapp', facet: 'messages',
    source_types: ['whatsapp_message_live'],
    intended_status: 'active', provider: 'in-process',
    pricing_model: { unit: 'in_process' },
    notes: 'Live message receiver. Hot-path Edge Function inserts l0/l1 directly.',
  },

  // ─── Candidates (benchmarked but not yet deployed) ───────────────
  {
    id: 'meeting:diarization:claude-sonnet-4.6-content-cue@2026-05-05',
    family: 'meeting', facet: 'diarization',
    source_types: ['meeting_audio'],
    intended_status: 'candidate', provider: 'openrouter',
    pricing_model: { unit: 'input_token', approx_usd_per_meeting: 0.10 },
    benchmark_data: {
      audio: '04-30 supercut.mp3',
      speaker_share_drift_pp: [11.3, 13.6, 6.0],
      chunks: 5, validated: '2026-05-05',
      notes: 'Inferior to acoustic. Fallback only.',
    },
    notes: 'v0.1 LLM-as-diarizer. Mirrors the manual 04-30 speaker-confidence.md heuristic.',
  },
  {
    id: 'assemblyai:universal@2026-05-05',
    family: 'meeting', facet: 'transcription_diarization_bundled',
    source_types: ['meeting_audio'],
    intended_status: 'candidate', provider: 'assemblyai',
    pricing_model: {
      unit: 'audio_hour_bundled', approx_usd_per_hour: 0.17,
      breakdown: { transcription: 0.15, diarization_addon: 0.02 },
    },
    benchmark_data: {
      audio: '04-30 supercut.mp3',
      wer: 0.2277, speaker_share_drift_pp: [0.3, 0.9, 1.3],
      wall_seconds_for_41_min: 6, validated: '2026-05-05',
    },
    notes: 'Validated 2026-05-05. Recommended production default for meeting ingest.',
  },
  {
    id: 'xai:grok-stt@2026-04-18',
    family: 'meeting', facet: 'transcription_diarization_bundled',
    source_types: ['meeting_audio'],
    intended_status: 'candidate', provider: 'xai',
    pricing_model: { unit: 'audio_hour_bundled', approx_usd_per_hour: 0.10 },
    benchmark_data: {
      audio: '04-30 supercut.mp3',
      wer: 0.3481, speaker_share_drift_pp: [0.8, 1.1, 0.1],
      wall_seconds_for_41_min: 27, validated: '2026-05-05',
      notes: '40% cheaper than AssemblyAI but materially worse transcription.',
    },
    notes: 'Best on smallest speaker (Yitschak). Cost-pressure swap-in.',
  },
  {
    id: 'elevenlabs:scribe-v2@2026-03-11',
    family: 'meeting', facet: 'transcription_diarization_bundled',
    source_types: ['meeting_audio'],
    intended_status: 'candidate', provider: 'elevenlabs',
    pricing_model: { unit: 'audio_hour_bundled', approx_usd_per_hour: 0.22 },
    benchmark_data: {
      audio: '04-30 supercut.mp3',
      validated: '2026-05-05',
      notes: 'Untested — API key quota blocked the test.',
    },
    notes: 'Released March 2026. Claims 98% speaker label accuracy, up to 32 speakers.',
  },
  {
    id: 'pyannoteai:community-1@2026',
    family: 'meeting', facet: 'diarization',
    source_types: ['meeting_audio'],
    intended_status: 'candidate', provider: 'pyannoteai',
    pricing_model: {
      unit: 'audio_hour_diarization_only', approx_usd_per_hour: 0.04,
      currency_native: 'EUR 0.035/hr',
    },
    notes: 'Cheapest acoustic-grade cloud diarization. Open-source pyannote community-1 hosted at-cost. Diar-only — pair with whisper.',
  },
];

/** Returns the catalog entry for an extractor id (`<extractor>@<version>`). */
export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id);
}

/** Returns all entries with a given intended status. */
export function getCatalogByStatus(status: ExtractorIntendedStatus): CatalogEntry[] {
  return CATALOG.filter((e) => e.intended_status === status);
}

/** Returns all entries that can produce events for a given source_type + facet. */
export function getCatalogByCapability(source_type: string, facet: ExtractorFacet): CatalogEntry[] {
  return CATALOG.filter(
    (e) => e.source_types.includes(source_type) && (e.facet === facet || e.facet === 'transcription_diarization_bundled' && (facet === 'transcription' || facet === 'diarization')),
  );
}

/** Get the full catalog. Used by sync script + introspection tools. */
export function getCatalog(): CatalogEntry[] {
  return [...CATALOG];
}
