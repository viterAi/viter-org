# View Spec Format — Reference

**Author:** Issac Brown  
**Last updated:** May 10, 2026  
**Status:** v1 — approved for implementation  
**TypeScript types:** `lib/types/spec.ts`

---

## Principle

A spec describes **what to communicate**, not **which component to render**.

Every spec node has a `node_type` that declares the *semantic intent* of the section — "show a ranking", "show a breakdown", "show key metrics" — and the renderer's mapping layer translates that intent into the right component given the context.

This means:

- The AI never decides which React component to use
- Component choices can be swapped without touching the spec
- The same spec can render differently on web vs. email vs. WhatsApp

---

## Top-Level Structure

```json
{
  "spec_version": 1,
  "view_id": "uuid",
  "view_name": "AR Overview",
  "view_type": "spatial",
  "source": {
    "scope_kind": "chat",
    "scope_key": "mvp-dev",
    "semantic_summary": "Team dev chat — 296 messages, 4 people, Mar–May 2026"
  },
  "nodes": [ ... ],
  "layout_hints": { ... },
  "design_tokens": { ... },
  "generated_at": "2026-05-07T18:00:00Z",
  "generator": "claude-opus-4-7"
}
```

### Required fields

| Field | Type | Description |
|-------|------|-------------|
| `spec_version` | `1` | Always `1` for this format |
| `view_id` | `string` | UUID — assigned at save time |
| `view_name` | `string` | Human-readable name shown in the tab |
| `view_type` | `spatial \| sequential \| briefing \| card \| config` | Which view-type skill generated this |
| `source.scope_kind` | `string` | The L2 scope type (e.g. `"day"`, `"chat"`, `"meeting"`) |
| `source.scope_key` | `string` | The specific scope value (e.g. `"2026-05-07"`, `"mvp-dev"`) |
| `nodes` | `SpecNode[]` | Ordered list of content nodes |
| `generated_at` | `string` | ISO 8601 |
| `generator` | `string` | Model slug that produced the spec |

---

## View Types

| `view_type` | When used | Key rules |
|-------------|-----------|-----------|
| `spatial` | Dashboards, boards, monitoring | F-pattern, ≤12 KPIs, 5-second comprehension |
| `sequential` | Triage, approval queues, checklists | One item at a time, ≤4 actions, progress visible |
| `briefing` | Digests, summaries, catch-up | Time-bounded framing, prioritisation hierarchy |
| `card` | Home surface, weighted priorities | Enough context per card to decide without opening |
| `config` | Setup, permissions, flow boards | Stable layout, drag-and-drop blocks |

---

## Spec Nodes

Each node in the `nodes` array has:
- `node_type` — the semantic intent
- `id` — unique within the spec (used for layout hints and Steer targeting)
- `mode` — `"static"` (structure fixed) or `"dynamic"` (can be swapped at runtime)
- `trigger` — for dynamic nodes: what event causes re-evaluation

### Static vs. Dynamic

```json
{ "mode": "static" }
```

Static nodes: data refreshes when the view loads, but the structure (fields, ranking, grouping) stays fixed. Safe to cache the render.

```json
{ "mode": "dynamic", "trigger": "dock_context_change" }
```

Dynamic nodes: the renderer re-evaluates the node when the trigger fires. Used for components that should respond to Steer actions, live data feeds, or agent events.

**Trigger values:**

| Trigger | Meaning |
|---------|---------|
| `dock_context_change` | User sent a message or took a Steer action in the dock |
| `agent_event` | An upstream agent emitted an event (e.g. new synthesis available) |
| `data_change` | The underlying L2 data has changed (new rows, stale flag cleared) |

---

## Node Types — Reference

### `metric_summary`
Shows a set of key numbers at a glance.  
**Renderer maps to:** `kpi_row`, `metric_card`

```json
{
  "node_type": "metric_summary",
  "id": "top_kpis",
  "label": "Key numbers",
  "metrics": [
    { "key": "open_invoice_count", "label": "Open invoices", "format": "number" },
    { "key": "total_overdue_eur",  "label": "Overdue",       "format": "currency" },
    { "key": "avg_days_outstanding", "label": "Avg days out", "format": "number", "trend_key": "avg_days_delta" }
  ],
  "mode": "static"
}
```

---

### `ranked_list`
Shows a set of items ordered by some dimension.  
**Renderer maps to:** `data_table`, `attention_list`, `entity_cards`

```json
{
  "node_type": "ranked_list",
  "id": "overdue_invoices",
  "label": "Overdue invoices",
  "data_source": "invoices",
  "row_key": "invoice_id",
  "rank_by": "days_outstanding",
  "rank_direction": "desc",
  "fields": [
    { "key": "client_name",       "label": "Client",      "format": "text",     "emphasis": true },
    { "key": "amount_eur",        "label": "Amount",      "format": "currency", "emphasis": true },
    { "key": "due_date",          "label": "Due",         "format": "date" },
    { "key": "days_outstanding",  "label": "Days out",    "format": "number" }
  ],
  "max_rows": 20,
  "row_actions": [
    {
      "id": "mark_followed_up",
      "label": "Mark followed up",
      "style": "primary",
      "routing": "write_back",
      "mcp_method": "update_invoice_status",
      "payload_template": { "status": "followed_up" }
    },
    {
      "id": "flag_dispute",
      "label": "Flag dispute",
      "style": "secondary",
      "routing": "write_back",
      "mcp_method": "update_invoice_status",
      "payload_template": { "status": "disputed" }
    }
  ],
  "mode": "dynamic",
  "trigger": "data_change"
}
```

---

### `breakdown`
Shows how a total is distributed across categories.  
**Renderer maps to:** `chart_bar`, `chart_donut`

```json
{
  "node_type": "breakdown",
  "id": "status_breakdown",
  "label": "By status",
  "data_source": "invoices",
  "group_by": "follow_up_status",
  "value_field": "amount_eur",
  "value_format": "currency",
  "max_groups": 5,
  "mode": "static"
}
```

---

### `trend`
Shows how a value changes over time.  
**Renderer maps to:** `chart_line`, `activity_feed`

```json
{
  "node_type": "trend",
  "id": "monthly_overdue",
  "label": "Overdue trend",
  "data_source": "invoices",
  "x_field": "due_date",
  "y_field": "amount_eur",
  "y_format": "currency",
  "mode": "static"
}
```

---

### `text_summary`
Shows narrative text — AI-generated prose or synthesis.  
**Renderer maps to:** `text_block`

```json
{
  "node_type": "text_summary",
  "id": "ai_summary",
  "label": "Situation",
  "content": "Overdue balance grew 18% this week. Acme Corp accounts for 40% of the total. Three invoices have been outstanding for more than 90 days.",
  "mode": "dynamic",
  "trigger": "agent_event"
}
```

---

### `sequence_item`
One unit in a sequential triage or approval flow.  
**Renderer maps to:** single-item focus card + action bar

```json
{
  "node_type": "sequence_item",
  "id": "approval_item",
  "label": "For review",
  "data_source": "pending_approvals",
  "row_key": "approval_id",
  "title_field": "request_title",
  "detail_fields": [
    { "key": "requester",   "label": "From",    "format": "text" },
    { "key": "amount_eur",  "label": "Amount",  "format": "currency" },
    { "key": "submitted_at","label": "Received","format": "date" }
  ],
  "actions": [
    { "id": "approve", "label": "Approve", "style": "primary",      "routing": "write_back", "mcp_method": "approve_request" },
    { "id": "reject",  "label": "Reject",  "style": "destructive",  "routing": "write_back", "mcp_method": "reject_request" },
    { "id": "defer",   "label": "Later",   "style": "secondary",    "routing": "view_only" }
  ],
  "mode": "dynamic",
  "trigger": "dock_context_change"
}
```

---

### `filter_controls`
Declares what filtering dimensions the user can apply.  
**Renderer maps to:** `filter_bar`

```json
{
  "node_type": "filter_controls",
  "id": "invoice_filters",
  "filters": [
    { "field": "follow_up_status", "label": "Status",  "control": "dropdown", "options": ["open","followed_up","disputed"] },
    { "field": "due_date",         "label": "Due date","control": "date_range" },
    { "field": "client_name",      "label": "Client",  "control": "search" }
  ],
  "mode": "static"
}
```

---

### `action_panel`
Declares view-level actions (not row-specific).  
**Renderer maps to:** `action_panel`

```json
{
  "node_type": "action_panel",
  "id": "view_actions",
  "actions": [
    { "id": "export_csv",     "label": "Export CSV", "style": "secondary", "routing": "view_only" },
    { "id": "send_reminders", "label": "Send reminders", "style": "primary", "routing": "agent", "mcp_method": "send_overdue_reminders" }
  ],
  "mode": "static"
}
```

---

## Full Examples

### Example 1 — Spatial: AR Dashboard (from WhatsApp mvp-dev data)

```json
{
  "spec_version": 1,
  "view_id": "550e8400-e29b-41d4-a716-446655440000",
  "view_name": "AR Overview",
  "view_type": "spatial",
  "source": {
    "scope_kind": "chat",
    "scope_key": "mvp-dev",
    "semantic_summary": "Accounts receivable discussion — open invoices, follow-up tracking, client status"
  },
  "nodes": [
    {
      "node_type": "metric_summary",
      "id": "top_kpis",
      "metrics": [
        { "key": "open_invoice_count", "label": "Open invoices", "format": "number" },
        { "key": "total_overdue_eur",  "label": "Overdue total", "format": "currency" },
        { "key": "avg_days_outstanding", "label": "Avg days out", "format": "number" }
      ],
      "mode": "static"
    },
    {
      "node_type": "filter_controls",
      "id": "invoice_filters",
      "filters": [
        { "field": "follow_up_status", "label": "Status", "control": "dropdown" },
        { "field": "client_name",      "label": "Client", "control": "search" }
      ],
      "mode": "static"
    },
    {
      "node_type": "ranked_list",
      "id": "overdue_invoices",
      "label": "Overdue invoices",
      "data_source": "invoices",
      "row_key": "invoice_id",
      "rank_by": "days_outstanding",
      "rank_direction": "desc",
      "fields": [
        { "key": "client_name",      "label": "Client",   "format": "text",     "emphasis": true },
        { "key": "amount_eur",       "label": "Amount",   "format": "currency", "emphasis": true },
        { "key": "days_outstanding", "label": "Days out", "format": "number" }
      ],
      "max_rows": 15,
      "row_actions": [
        { "id": "mark_followed_up", "label": "Mark followed up", "style": "primary", "routing": "write_back", "mcp_method": "update_invoice_status", "payload_template": { "status": "followed_up" } }
      ],
      "mode": "dynamic",
      "trigger": "data_change"
    },
    {
      "node_type": "breakdown",
      "id": "status_breakdown",
      "label": "By status",
      "data_source": "invoices",
      "group_by": "follow_up_status",
      "value_field": "amount_eur",
      "value_format": "currency",
      "mode": "static"
    }
  ],
  "layout_hints": {
    "columns": 2,
    "node_columns": {
      "top_kpis": 0,
      "invoice_filters": 0,
      "overdue_invoices": 0,
      "status_breakdown": 1
    }
  },
  "generated_at": "2026-05-07T18:00:00Z",
  "generator": "claude-opus-4-7"
}
```

---

### Example 2 — Sequential: Approval Queue

```json
{
  "spec_version": 1,
  "view_id": "660e8400-e29b-41d4-a716-446655440001",
  "view_name": "Pending Approvals",
  "view_type": "sequential",
  "source": {
    "scope_kind": "day",
    "scope_key": "2026-05-07",
    "semantic_summary": "3 pending expense approvals from the Shaul and Yitzchak conversations"
  },
  "nodes": [
    {
      "node_type": "metric_summary",
      "id": "queue_progress",
      "metrics": [
        { "key": "items_remaining", "label": "Remaining", "format": "number" },
        { "key": "items_done",      "label": "Done",      "format": "number" }
      ],
      "mode": "dynamic",
      "trigger": "dock_context_change"
    },
    {
      "node_type": "sequence_item",
      "id": "approval_item",
      "data_source": "pending_approvals",
      "row_key": "approval_id",
      "title_field": "request_title",
      "detail_fields": [
        { "key": "requester",    "label": "From",    "format": "text" },
        { "key": "amount_eur",   "label": "Amount",  "format": "currency" },
        { "key": "submitted_at", "label": "Received","format": "date" },
        { "key": "description",  "label": "Details", "format": "text" }
      ],
      "actions": [
        { "id": "approve", "label": "Approve", "style": "primary",     "routing": "write_back", "mcp_method": "approve_request" },
        { "id": "reject",  "label": "Reject",  "style": "destructive", "routing": "write_back", "mcp_method": "reject_request" },
        { "id": "ask",     "label": "Ask",     "style": "secondary",   "routing": "agent",      "mcp_method": "request_clarification" },
        { "id": "defer",   "label": "Later",   "style": "secondary",   "routing": "view_only" }
      ],
      "mode": "dynamic",
      "trigger": "dock_context_change"
    }
  ],
  "generated_at": "2026-05-07T18:00:00Z",
  "generator": "claude-opus-4-7"
}
```

---

### Example 3 — Briefing: Daily Digest

```json
{
  "spec_version": 1,
  "view_id": "770e8400-e29b-41d4-a716-446655440002",
  "view_name": "May 7 — Daily Brief",
  "view_type": "briefing",
  "source": {
    "scope_kind": "day",
    "scope_key": "2026-05-07",
    "semantic_summary": "Daily synthesis from all channels — WhatsApp messages, meeting summaries, agent activity"
  },
  "nodes": [
    {
      "node_type": "text_summary",
      "id": "opening",
      "label": "Today",
      "content": "3 things need your attention. 2 meetings happened. Shaul is waiting on a decision about the Railway deployment.",
      "mode": "static"
    },
    {
      "node_type": "ranked_list",
      "id": "action_items",
      "label": "Needs your attention",
      "data_source": "action_items",
      "row_key": "item_id",
      "rank_by": "priority",
      "rank_direction": "desc",
      "fields": [
        { "key": "title",       "label": "Item",   "format": "text", "emphasis": true },
        { "key": "source",      "label": "From",   "format": "text" },
        { "key": "created_at",  "label": "When",   "format": "date" }
      ],
      "max_rows": 5,
      "mode": "static"
    },
    {
      "node_type": "ranked_list",
      "id": "meeting_summaries",
      "label": "Today's meetings",
      "data_source": "meetings",
      "row_key": "meeting_id",
      "rank_by": "started_at",
      "rank_direction": "asc",
      "fields": [
        { "key": "title",       "label": "Meeting", "format": "text", "emphasis": true },
        { "key": "duration_min","label": "Length",  "format": "number" },
        { "key": "participants","label": "With",    "format": "text" }
      ],
      "max_rows": 5,
      "mode": "static"
    },
    {
      "node_type": "text_summary",
      "id": "closing",
      "label": "That's it",
      "content": "You're caught up on May 7.",
      "mode": "static"
    }
  ],
  "generated_at": "2026-05-07T18:00:00Z",
  "generator": "claude-opus-4-7"
}
```

---

## Design Tokens

There are two separate token systems in the codebase — do not confuse them:

### 1. Spec-embedded overrides (`ViewSpec.design_tokens`)

An optional per-spec field that carries lightweight theming overrides for a specific view.
TypeScript type: `DesignTokens` in `lib/types/spec.ts`.

```json
{
  "design_tokens": {
    "primary_color": "#0066FF",
    "secondary_color": "#F5F5F5",
    "font_family": "Inter, sans-serif",
    "card_radius": "8px",
    "button_style": "solid",
    "table_density": "comfortable"
  }
}
```

Schema: `primary_color`, `secondary_color`, `font_family`, `font_size_base`, `card_radius`, `button_style`, `table_density`.

### 2. App-level CSS token system (`lib/design/`)

A separate, richer system for the app's own UI components.
TypeScript type: `DesignTokens` in `lib/design/tokens.ts` (different struct — full color palette, typography, spacing, radius, shadows).
Applied by `lib/design/TokenProvider.tsx` as CSS variables at the `<html>` root.
Documented in `docs/design-tokens.md`.

The two systems are independent. Spec-embedded tokens are renderer hints; app tokens control the shell UI.

---

## Mapping Layer

The spec never references React component IDs. The renderer's mapping layer in `lib/view/spec-mapper.ts` translates node types to components:

| `node_type` | Candidate components | Selection logic |
|-------------|---------------------|-----------------|
| `metric_summary` | `kpi_row`, `metric_card` | ≤3 metrics → `metric_card`; >3 → `kpi_row` |
| `ranked_list` | `data_table`, `attention_list`, `entity_cards` | max_rows ≤ 5 → `attention_list`; has row_actions → `data_table`; no actions, emphasis fields → `entity_cards` |
| `breakdown` | `chart_bar`, `chart_donut` | `max_groups` ≤ 5 → `chart_donut`; `max_groups` > 5 or omitted → `chart_bar` |
| `trend` | `chart_line`, `activity_feed` | `x_field` name contains `"date"` or `"at"` → `chart_line`; otherwise `activity_feed` |
| `text_summary` | `text_block` | Always `text_block` |
| `sequence_item` | *(custom sequential renderer)* | Always sequential card |
| `filter_controls` | `filter_bar` | Always `filter_bar` |
| `action_panel` | `action_panel` | Always `action_panel` |

---

## Action Routing

| `routing` value | What happens | External call? |
|-----------------|--------------|----------------|
| `view_only` | In-memory filter/UI change | No |
| `write_back` | Writes to source system via Mrodchi's MCP server | Yes — `mcp_method` required |
| `agent` | Triggers an agent or automation via Mrodchi's MCP server | Yes — `mcp_method` required |

All boundary-crossing actions (`write_back`, `agent`) are intended to be logged to the Supabase `view_events` table (schema exists; write-back logging not yet wired — tracked in Issue A4).

---

## Validation Rules

A generated spec is valid if:

1. `spec_version` is `1`
2. `view_type` is one of the five allowed values
3. Every node has a unique `id` within the spec
4. Dynamic nodes have a `trigger` field
5. Every field reference (`key`, `row_key`, `rank_by`, `group_by`, `x_field`, `y_field`) exists in the data source
6. `sequence_item` nodes have at most 4 actions (sequential skill rule)
7. `metric_summary` nodes have at most 12 metrics (spatial skill rule)
8. `write_back` and `agent` actions have `mcp_method` set
9. `layout_hints.node_columns` only references node IDs that exist in `nodes`
