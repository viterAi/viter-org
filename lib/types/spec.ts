/**
 * Abstract View Spec — the core contract between the AI generation layer and the renderer.
 *
 * A spec describes WHAT to communicate, not which component to render.
 * The renderer's mapping layer translates spec nodes into concrete components.
 *
 * Spec version: 1
 */

// ---------------------------------------------------------------------------
// Top-level view types
// ---------------------------------------------------------------------------

/** The five surface patterns supported by the View Builder. */
export type ViewType =
  | "spatial"    // Dashboard — multiple panels, F-pattern layout, glanceable
  | "sequential" // One-item-at-a-time flow — triage, approval, checklist
  | "briefing"   // Digest / catch-up — time-bounded, prioritised narrative
  | "card"       // Weighted card grid — home surface, priority-driven sizing
  | "config";    // Setup / permissions / flow board — stable, drag-and-drop

// ---------------------------------------------------------------------------
// Component update modes
// ---------------------------------------------------------------------------

/** Whether a spec node is fixed-structure or can be swapped at runtime. */
export type ComponentMode = "static" | "dynamic";

/**
 * What event causes a dynamic component to re-evaluate.
 * - dock_context_change: user message or Steer action in the dock
 * - agent_event:         an upstream agent emits an event
 * - data_change:         the underlying L2 data has changed
 */
export type ComponentTrigger =
  | "dock_context_change"
  | "agent_event"
  | "data_change";

// ---------------------------------------------------------------------------
// Spec node types — abstract semantic intents
// ---------------------------------------------------------------------------

/**
 * A metric_summary communicates a small set of key numbers at a glance.
 * Renderer maps to: kpi_row, metric_card
 */
export interface MetricSummaryNode {
  node_type: "metric_summary";
  id: string;
  label?: string;
  metrics: Array<{
    key: string;       // field name from the data source
    label: string;     // human-readable label
    format?: "number" | "currency" | "percent" | "duration" | "text";
    trend_key?: string; // optional: field that holds the delta / direction
  }>;
  mode: ComponentMode;
  trigger?: ComponentTrigger;
}

/**
 * A ranked_list communicates a set of items ordered by some dimension.
 * Renderer maps to: data_table, attention_list, entity_cards
 */
export interface RankedListNode {
  node_type: "ranked_list";
  id: string;
  label?: string;
  data_source: string;        // which L2 source or field group to pull from
  row_key: string;            // unique identifier field per row
  rank_by: string;            // field to sort by
  rank_direction?: "asc" | "desc";
  fields: Array<{
    key: string;
    label: string;
    format?: "number" | "currency" | "percent" | "date" | "text";
    emphasis?: boolean;       // hint: this field deserves visual weight
  }>;
  max_rows?: number;
  row_actions?: RowAction[];
  mode: ComponentMode;
  trigger?: ComponentTrigger;
}

/**
 * A breakdown communicates how a total is distributed across categories.
 * Renderer maps to: chart_bar, chart_donut
 */
export interface BreakdownNode {
  node_type: "breakdown";
  id: string;
  label?: string;
  data_source: string;
  group_by: string;           // categorical field to split on
  value_field: string;        // numeric field to sum
  value_format?: "number" | "currency" | "percent";
  max_groups?: number;        // collapse tail into "Other" beyond this
  mode: ComponentMode;
  trigger?: ComponentTrigger;
}

/**
 * A trend communicates how a value changes over time.
 * Renderer maps to: chart_line, activity_feed
 */
export interface TrendNode {
  node_type: "trend";
  id: string;
  label?: string;
  data_source: string;
  x_field: string;            // time dimension
  y_field: string;            // value dimension
  y_format?: "number" | "currency" | "percent";
  mode: ComponentMode;
  trigger?: ComponentTrigger;
}

/**
 * A text_summary communicates a narrative — AI-generated prose or synthesis.
 * Renderer maps to: text_block
 */
export interface TextSummaryNode {
  node_type: "text_summary";
  id: string;
  label?: string;
  content: string;            // the actual text (filled at generation time)
  mode: ComponentMode;
  trigger?: ComponentTrigger;
}

/**
 * A sequence_item is one unit in a sequential flow.
 * Renderer maps to: single-item focus card + action bar
 */
export interface SequenceItemNode {
  node_type: "sequence_item";
  id: string;
  label?: string;
  data_source: string;
  row_key: string;
  title_field: string;
  detail_fields: Array<{
    key: string;
    label: string;
    format?: "number" | "currency" | "percent" | "date" | "text";
  }>;
  actions: RowAction[];       // max 4 per sequential skill rules
  mode: ComponentMode;
  trigger?: ComponentTrigger;
}

/**
 * A filter_controls node declares what filtering dimensions are available.
 * Renderer maps to: filter_bar
 */
export interface FilterControlsNode {
  node_type: "filter_controls";
  id: string;
  label?: string;
  filters: Array<{
    field: string;
    label: string;
    control: "dropdown" | "date_range" | "search" | "toggle";
    options?: string[];       // for dropdowns: known values (optional, renderer can derive)
  }>;
  mode: ComponentMode;
  trigger?: ComponentTrigger;
}

/**
 * An action_panel communicates what the user can do at the view level.
 * Renderer maps to: action_panel
 */
export interface ActionPanelNode {
  node_type: "action_panel";
  id: string;
  label?: string;
  actions: ViewAction[];
  mode: ComponentMode;
  trigger?: ComponentTrigger;
}

/**
 * A timeline communicates tasks or milestones with start/end dates.
 * Renderer maps to: chart_gantt
 */
export interface TimelineNode {
  node_type: "timeline";
  id: string;
  label?: string;
  data_source: string;
  title_field: string;      // field for the task/item name
  start_field?: string;     // field for start date (optional)
  end_field: string;        // field for end/due date
  status_field?: string;    // field for status (used for colour coding)
  max_rows?: number;
  mode: ComponentMode;
  trigger?: ComponentTrigger;
}

/** Union of all possible spec nodes. */
export type SpecNode =
  | MetricSummaryNode
  | RankedListNode
  | BreakdownNode
  | TrendNode
  | TextSummaryNode
  | SequenceItemNode
  | FilterControlsNode
  | ActionPanelNode
  | TimelineNode;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** An action a user can take on a single row. */
export interface RowAction {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "destructive";
  /**
   * Where this action routes:
   * - view_only:   pure UI (filter, highlight) — no external call
   * - write_back:  persists a change to the source system (via Mrodchi MCP)
   * - agent:       triggers an agent or automation (via Mrodchi MCP)
   */
  routing: "view_only" | "write_back" | "agent";
  /** For write_back / agent: the method name on Mrodchi's MCP server. */
  mcp_method?: string;
  /** Static payload merged with the row context on call. */
  payload_template?: Record<string, unknown>;
}

/** An action available at the view level (not row-specific). */
export interface ViewAction {
  id: string;
  label: string;
  style?: "primary" | "secondary" | "destructive";
  routing: "view_only" | "write_back" | "agent";
  mcp_method?: string;
  payload_template?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

/** Optional theming parameters. Components accept these from day one. */
export interface DesignTokens {
  primary_color?: string;
  secondary_color?: string;
  font_family?: string;
  font_size_base?: string;
  card_radius?: string;
  button_style?: "solid" | "outline" | "ghost";
  table_density?: "compact" | "comfortable" | "spacious";
}

// ---------------------------------------------------------------------------
// Top-level ViewSpec
// ---------------------------------------------------------------------------

export interface ViewSpec {
  spec_version: 1;
  view_id: string;
  view_name: string;
  view_type: ViewType;

  /**
   * The data context this spec was generated from.
   * e.g. scope_kind: "day", scope_key: "2026-05-07"
   * or   scope_kind: "chat", scope_key: "mvp-dev"
   */
  source: {
    scope_kind: string;
    scope_key: string;
    /** Free-text description of what the data represents semantically. */
    semantic_summary?: string;
  };

  /** Ordered list of spec nodes — the view's content, top to bottom / left to right. */
  nodes: SpecNode[];

  /**
   * Optional layout hints for the renderer.
   * Only meaningful for spatial views (multi-column grids).
   * Sequential, briefing, card, and config views ignore this.
   */
  layout_hints?: {
    columns?: 1 | 2 | 3;
    /**
     * Column assignment per node id.
     * e.g. { "top_kpis": 0, "overdue_list": 0, "breakdown_chart": 1 }
     */
    node_columns?: Record<string, number>;
  };

  design_tokens?: DesignTokens;

  /** ISO 8601 timestamp of when this spec was generated. */
  generated_at: string;
  /** Which model/generator produced this spec. */
  generator: string;
}
