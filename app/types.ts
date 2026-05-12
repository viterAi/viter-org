/**
 * A user-visible "source" in the sidebar — can be either a single channel
 * (`gmail:yy@upvlu.com`) or a kind-scoped group leaf
 * (`gmail::from_email=alice@x.com`).
 *
 * `id` is the *stable composite key* used in URLs, localStorage, and
 * `views.source_id`. Route handlers resolve `id` back to either one channel
 * or N channels + a payload filter via `parseSourceKey()`.
 *
 * `key` is kept as a duplicate of `id` for backward compatibility with code
 * that distinguishes them (e.g. the steer route's classifier prompt).
 */
export type Source = {
  id: string;
  name: string;
  key: string;
  channel?: string;
  markdown?: string;
};

export type SourceChannel = string;
export type SourceSeedFormat = "markdown" | "json" | "csv";

/**
 * Per-service-kind grouping configuration mirrored from
 * `public.genui_kind_grouping`. Drives sidebar sub-source rendering and
 * informs the Corn-jobs admin panel.
 */
export type KindGrouping = {
  kind: string;
  group_field: string;
  group_label: string;
  timestamp_field: string | null;
  display_regex: string | null;
  confidence: "seed" | "ai" | "heuristic" | "admin";
  last_error: string | null;
  updated_at: string;
};

/**
 * One leaf under a kind in the sidebar tree (when grouping is active).
 * `id` is the kind-scoped composite key (`<kind>::<group_field>=<group_value>`).
 */
export type SourceGroup = {
  id: string;
  key: string;
  name: string;
  channel: string;
  group_field: string;
  group_value: string;
  message_count: number;
  latest_at: string | null;
  is_other?: boolean;
};

/**
 * Sidebar tree node — one per service kind the user has connected channels
 * for. When `groups` is non-empty the sidebar renders them as leaves;
 * otherwise it falls back to today's per-channel leaves.
 */
export type SourceTreeNode = {
  kind: string;
  channels: Source[];
  grouping: KindGrouping | null;
  groups: SourceGroup[];
};

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

export type ComponentMode = "static" | "dynamic";
export type ComponentTrigger = "dock_context_change" | "agent_event" | "data_change";

export type AiComponent = {
  component_id: string;
  props?: Record<string, unknown>;
  /** Whether this component re-evaluates when a trigger fires. Defaults to "static". */
  mode?: ComponentMode;
  /** Which event causes this dynamic component to re-evaluate. */
  trigger?: ComponentTrigger;
};

export type AiPage = {
  id: string;
  title: string;
  description?: string;
  components: AiComponent[];
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
