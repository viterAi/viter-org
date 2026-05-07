# T-003 — Design Abstract Spec Format

**Wave:** 1 — Foundation  
**Estimate:** 1 day  
**Depends on:** Nothing (can start immediately, parallel to T-001/T-002)  
**Blocks:** Almost everything downstream — this is the seam between agent and renderer

---

## Context

The spec is the data structure that the agent produces and the build engine consumes. It describes *what* a view should show — not *how* to render it.

This abstraction is critical because we want optionality: today we use our own renderer; tomorrow we may use v0; later we'll target MCP Apps; eventually the same spec may render to WhatsApp, email, or a mobile app. The spec must be renderer-agnostic.

The current implementation has the spec tightly coupled to the 15 primitive component types (e.g., `{ component: "kpi_row", props: { ... } }`). This is the coupling we're breaking.

---

## Scope

Design and implement a renderer-agnostic spec format. Build a thin mapping layer between the abstract spec and the current renderer so existing functionality keeps working. Document the format clearly.

---

## Deliverables

1. A TypeScript type definition for the spec format (`lib/spec/types.ts` or similar)
2. A mapping layer that translates the abstract spec into the current renderer's component tree
3. A migration: update the AI generation prompt to produce the new abstract format
4. Three example specs (in `docs/spec-examples/`) showing the format for different view types
5. Documentation: `docs/spec-format.md` explaining each field

---

## The Spec Format — Specification

The spec MUST include these top-level fields:

```typescript
interface ViewSpec {
  view_id: string;          // unique identifier
  view_name: string;        // user-facing name
  view_type: 'spatial' | 'sequential' | 'briefing' | 'card' | 'config';
  source_id: string;        // which source this view is for
  
  data_requirements: DataRequirement[];  // what data the view needs
  layout: LayoutNode;                    // the visual structure
  actions: ActionDefinition[];           // what the user can do
  
  design_tokens?: DesignTokens;          // optional theming overrides
  metadata: SpecMetadata;                // version, created_at, etc.
}
```

### LayoutNode (the abstract part)

A `LayoutNode` describes intent and data, NOT a specific component. Examples:

**Right (abstract):**
```json
{
  "type": "metric_strip",
  "intent": "show key summary metrics prominently at the top",
  "metrics": [
    { "label": "Total Outstanding", "value_binding": "sum(invoices.amount where status=overdue)", "format": "currency", "trend": { "direction": "up", "context": "vs. last month" } }
  ],
  "mode": "static"
}
```

**Wrong (coupled to renderer):**
```json
{
  "component": "kpi_row",
  "props": { "items": [{ "label": "Total", "value": "$45,200" }] }
}
```

The abstract version describes the *semantic intent* and the *data binding* (where the value comes from). A renderer maps this to its own components. The current renderer maps `metric_strip` → `kpi_row`. A future v0 renderer maps it to a different component. An MCP Apps renderer maps it to generated HTML.

### Required LayoutNode types for v1

The spec format must support at least these abstract node types:

- `metric_strip` — a row of summary metrics
- `data_table` — tabular data with optional sort/filter/actions
- `card_grid` — entity cards in a grid
- `chart` — bar / line / pie / donut
- `board` — kanban-style with columns
- `timeline` — chronological events
- `detail_panel` — full entity view with related items
- `filter_bar` — controls for filtering the view
- `action_bar` — buttons that trigger actions
- `text_block` — rendered prose (for descriptions, headings)
- `flow_builder` — drag-and-drop block diagram (for config views)
- `single_item_focus` — one entity, full detail (for sequential views)

### Mode field (per node)

Every LayoutNode must include a `mode` field:
- `"static"` — data refreshes; structure does not change
- `"dynamic"` — can be swapped/updated based on triggers (must include a `trigger` field)

### Trigger field (for dynamic nodes)

Examples: `"dock_context_change"`, `"agent_event"`, `"data_change"`, `"user_steer"`. Defines when this component should re-render.

### Data binding format

Data bindings are expressions that reference source entities and fields. Format:
- `"source.entity.field"` — direct field reference (e.g., `"xero.invoices.amount"`)
- `"sum(source.entity.field where condition)"` — aggregations
- `"count(source.entity where condition)"` — counts
- `"latest(source.entity.field)"` — most recent value

The mapping layer is responsible for resolving these expressions against the actual data.

---

## Acceptance Criteria

- [ ] `ViewSpec` TypeScript type exists with all fields documented inline
- [ ] All 12 LayoutNode types listed above are defined as TypeScript types
- [ ] `mode` and `trigger` fields are required on every LayoutNode (TypeScript enforces this)
- [ ] Mapping layer (`lib/spec/render-mapper.ts`) translates abstract spec → current renderer's input
- [ ] AI generation prompt updated: produces abstract format, not renderer-coupled format
- [ ] Three example specs in `docs/spec-examples/`:
  - `spatial-dashboard.json` — a spatial view with KPIs, table, and chart
  - `sequential-triage.json` — a sequential view with single-item focus and action bar
  - `config-flow-board.json` — a config view with a flow builder and authorize action
- [ ] `docs/spec-format.md` documents every field, with examples
- [ ] All existing views still render correctly after the migration (manual smoke test)
- [ ] If you can't make existing views work, the migration is incomplete — do not merge

---

## Notes for the Agent

- This is the most architecturally important ticket in Wave 1. Take time to think before coding.
- The abstract spec should be readable. A human looking at the JSON should understand what the view shows without consulting documentation.
- Resist the temptation to add fields "just in case." If a field isn't needed for the v1 view types, leave it out. We can extend later.
- The mapping layer is allowed to be hardcoded for the current renderer — we're not building a plugin system yet, just an abstraction layer.
- Test by generating a view with the new format and confirming it renders identically to the old format.
