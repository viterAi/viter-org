export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ViewMode = "tabbed" | "composed";

export type ViewType = "aging_table" | "follow_up_kanban";

export type TableColumnKind = "string" | "number" | "date";

export interface TableColumnLayout {
  id: string;
  field: string;
  label: string;
  kind: TableColumnKind;
}

export interface TableLayoutSpec {
  spec_version: number;
  generator: "openrouter_ai" | "deterministic_fallback";
  component_id?: string;
  columns: TableColumnLayout[];
  row_key: string;
}

export interface PersistedViewSpec {
  layout: TableLayoutSpec;
}

export type SourceDataRow = Record<string, Json | undefined>;

export interface SourceCanvasLoadResponse {
  views: ViewRecord[];
  rows: SourceDataRow[];
  active_view_id: string | null;
  was_generated: boolean;
  pending_draft: ViewDraftRecord | null;
  ai_pages?: AiPageRecord[];
  ai_warnings?: string[];
  ai_status: {
    state: "generating" | "invalid" | "ready";
    attempt: number;
    max_attempts: number;
    last_error: string | null;
  };
}

export interface AiPageRecord {
  id: string;
  title: string;
  components: Array<{
    component_id: string;
    props?: Record<string, Json>;
  }>;
}

export interface SourceRecord {
  id: string;
  key: string;
  name: string;
  channel: "whatsapp" | "email" | "portal" | "manual_upload";
  description: string | null;
  markdown: string;
  seed_format: "markdown" | "json" | "csv";
  created_at: string;
}

export interface ViewRecord {
  id: string;
  source_id: string;
  view_name: string;
  view_type: ViewType;
  sort_order: number;
  is_default: boolean;
  current_spec_version: number;
  spec: PersistedViewSpec | Json;
  ui_state: Json;
  created_at: string;
  updated_at: string;
}

export interface ViewDraftRecord {
  id: string;
  view_id: string;
  source_fingerprint: string;
  spec: PersistedViewSpec | Json;
  status: "pending" | "applied" | "discarded";
  created_at: string;
}
