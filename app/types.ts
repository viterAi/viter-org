export type Source = {
  id: string;
  name: string;
  key: string;
  channel?: string;
  markdown?: string;
};

export type SourceChannel = string;
export type SourceSeedFormat = "markdown" | "json" | "csv";

export type View = {
  id: string;
  source_id: string;
  view_name: string;
  view_type: "aging_table" | "follow_up_kanban";
  is_default: boolean;
  spec?: {
    layout?: {
      row_key?: string;
      columns?:
        | Array<{
            id: string;
            field: string;
            label: string;
            kind: "string" | "number" | "date";
          }>
        | string[];
    };
  };
};

export type Row = Record<string, string | number | boolean | null>;

export type Draft = {
  id: string;
  view_id: string;
  source_fingerprint: string;
  status: "pending" | "applied" | "discarded";
};

export type UiColumn = {
  id: string;
  field: string;
  label: string;
  kind: "string" | "number" | "date";
};

export type AiPage = {
  id: string;
  title: string;
  description?: string;
  components: Array<{ component_id: string; props?: Record<string, unknown> }>;
};

export type AiPageStatus = {
  page_id: string;
  state: "ready" | "invalid";
  attempts_used: number;
  last_error: string | null;
  warnings: string[];
};

export type AiStatus = {
  state: "generating" | "invalid" | "ready" | "plan_failed";
  last_error: string | null;
};

export type ProgressStep =
  | { type: "planning" }
  | { type: "plan_ready"; pages: Array<{ id: string; title: string; description: string }> }
  | { type: "page_start"; page_id: string; title: string; max_attempts: number }
  | { type: "page_attempt"; page_id: string; attempt: number; max_attempts: number; last_error: string | null }
  | { type: "page_done"; page_id: string; title: string; attempts_used: number }
  | { type: "page_failed"; page_id: string; last_error: string | null; attempts_used: number }
  | { type: "done" }
  | { type: "error"; error: string };
