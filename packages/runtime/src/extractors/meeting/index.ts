/**
 * Meeting extractor — long-form audio → L1 transcription events.
 *
 * Generalization of scripts/insert-ahiya-meeting-l1.ts. The one-shot script
 * remains in place for the May 5 promotion-of-record; this module is what
 * the production trigger task drives.
 *
 * Produces:
 *   - 1× l1_extraction_run(facet='transcription')
 *   - N× l1_events(facet='transcription', modality='voice') — one per chunk
 *   - 1× l1_active_extraction promotion
 *
 * Other meeting facets (diarization, emotion, topic_segments) live in
 * sibling modules to be added; the source-type seed already declares them
 * as default_facets.
 */

export {
  transcribeMeeting,
  MEETING_DEFAULT_MODEL,
  MEETING_EXTRACTOR_VERSION,
  MEETING_DEFAULT_CHUNK_MIN,
  MEETING_DEFAULT_BIAS_PROMPT,
} from './transcribe.js';

export type {
  MeetingChunk,
  MeetingChunkTranscript,
  MeetingTranscribeArgs,
  MeetingTranscribeResult,
} from './transcribe.js';

export {
  diarizeChunk,
  diarizeMeeting,
  DIARIZE_DEFAULT_MODEL,
  DIARIZE_EXTRACTOR_VERSION,
} from './diarize.js';

export type {
  SpeakerHint,
  DiarizedSegment,
  DiarizeChunkArgs,
  DiarizeChunkResult,
} from './diarize.js';

export {
  transcribeWithAssemblyAI,
  ASSEMBLYAI_EXTRACTOR_VERSION,
  ASSEMBLYAI_MODEL_ID,
} from './assemblyai.js';

export type {
  AssemblyAIUtterance,
  AssemblyAITranscribeArgs,
  AssemblyAITranscribeResult,
} from './assemblyai.js';
