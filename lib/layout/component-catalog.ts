import type { PersistedViewSpec, SourceDataRow, TableColumnKind } from "../types/view-builder";

export interface CatalogComponent {
  id: string;
  description: string;
  slots: string[];
  allowed_props: string[];
  required_data_fields: string[];
  sample: Record<string, unknown>;
}

export interface LayoutValidationIssue {
  path: string;
  rule: string;
  expected: string;
  allowed_alternatives: string[];
}

export const COMPONENT_CATALOG: CatalogComponent[] = [
  {
    id: "data_table",
    description: "Tabular layout for operational datasets with configurable columns.",
    slots: [],
    allowed_props: ["row_key", "columns"],
    required_data_fields: [],
    sample: {
      component_id: "data_table",
      row_key: "invoice_id",
      columns: [
        { id: "invoice_id", field: "invoice_id", label: "Invoice ID", kind: "string" },
        { id: "amount_cents", field: "amount_cents", label: "Amount", kind: "number" },
      ],
    },
  },
  {
    id: "text_block",
    description: "Short explanatory text block.",
    slots: [],
    allowed_props: ["title", "body"],
    required_data_fields: [],
    sample: { title: "Summary", body: "Open invoices increased this week." },
  },
  {
    id: "kpi_row",
    description: "Horizontal metrics row.",
    slots: [],
    allowed_props: ["metrics"],
    required_data_fields: [],
    sample: { metrics: [{ label: "Open", value: "12" }] },
  },
  {
    id: "metric_card",
    description: "Single KPI card.",
    slots: [],
    allowed_props: ["label", "value", "hint"],
    required_data_fields: [],
    sample: { label: "Total", value: "EUR 1.4M" },
  },
  {
    id: "attention_list",
    description: "List of items needing attention.",
    slots: [],
    allowed_props: ["title", "items", "max_items"],
    required_data_fields: [],
    sample: { title: "Needs attention", max_items: 5 },
  },
  {
    id: "activity_feed",
    description: "Timeline-style list of activity messages.",
    slots: [],
    allowed_props: ["title", "items", "max_items"],
    required_data_fields: [],
    sample: { title: "Activity", max_items: 8 },
  },
  {
    id: "kanban_board",
    description: "Lane-based task board.",
    slots: [],
    allowed_props: ["group_by", "title_field", "subtitle_field", "value_field", "lanes"],
    required_data_fields: [],
    sample: { group_by: "follow_up_status", lanes: ["todo", "in_progress", "followed_up"] },
  },
  {
    id: "entity_cards",
    description: "Grid of cards from row entities.",
    slots: [],
    allowed_props: ["title_field", "subtitle_field", "value_field", "max_items"],
    required_data_fields: [],
    sample: { title_field: "client_name", value_field: "amount_cents", max_items: 6 },
  },
  {
    id: "filter_bar",
    description: "UI hint block for active filters.",
    slots: [],
    allowed_props: ["fields", "title"],
    required_data_fields: [],
    sample: { title: "Filters", fields: ["status", "assignee"] },
  },
  {
    id: "chart_bar",
    description: "Simple grouped bar summary.",
    slots: [],
    allowed_props: ["group_by", "value_field", "title"],
    required_data_fields: [],
    sample: { group_by: "status", value_field: "amount_cents" },
  },
  {
    id: "chart_line",
    description: "Trend summary by date.",
    slots: [],
    allowed_props: ["x_field", "y_field", "title"],
    required_data_fields: [],
    sample: { x_field: "due_date", y_field: "amount_cents" },
  },
  {
    id: "chart_donut",
    description: "Composition summary by category.",
    slots: [],
    allowed_props: ["group_by", "value_field", "title"],
    required_data_fields: [],
    sample: { group_by: "follow_up_status", value_field: "amount_cents" },
  },
  {
    id: "action_panel",
    description: "Calls-to-action for the current page.",
    slots: [],
    allowed_props: ["title", "actions"],
    required_data_fields: [],
    sample: { title: "Actions", actions: ["mark_followed_up"] },
  },
  {
    id: "empty_state",
    description: "Placeholder when no data or no layout.",
    slots: [],
    allowed_props: ["title", "message"],
    required_data_fields: [],
    sample: { title: "No content", message: "AI did not select components." },
  },
  {
    id: "ai_status_panel",
    description: "AI generation status component.",
    slots: [],
    allowed_props: ["state", "attempt", "max_attempts", "last_error"],
    required_data_fields: [],
    sample: { state: "invalid", attempt: 2, max_attempts: 2, last_error: "unknown_component" },
  },
];

const VALID_KINDS: TableColumnKind[] = ["string", "number", "date"];

export function getCatalogPromptBlock(): string {
  return JSON.stringify(
    COMPONENT_CATALOG.map((component) => ({
      id: component.id,
      description: component.description,
      slots: component.slots,
      allowed_props: component.allowed_props,
      required_data_fields: component.required_data_fields,
      sample: component.sample,
    })),
    null,
    2,
  );
}

export function validateSpecAgainstCatalog(
  spec: PersistedViewSpec,
  rows: SourceDataRow[],
): LayoutValidationIssue[] {
  const issues: LayoutValidationIssue[] = [];
  const availableFields = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) availableFields.add(key);
  }

  if (!spec.layout.component_id) {
    issues.push({
      path: "layout.component_id",
      rule: "required_component",
      expected: "A catalog component id is required.",
      allowed_alternatives: COMPONENT_CATALOG.map((component) => component.id),
    });
  } else if (!COMPONENT_CATALOG.some((component) => component.id === spec.layout.component_id)) {
    issues.push({
      path: "layout.component_id",
      rule: "unknown_component",
      expected: "component_id must exist in the fixed component catalog.",
      allowed_alternatives: COMPONENT_CATALOG.map((component) => component.id),
    });
  }

  if (spec.layout.row_key && availableFields.size > 0 && !availableFields.has(spec.layout.row_key)) {
    issues.push({
      path: "layout.row_key",
      rule: "unknown_row_key",
      expected: `row_key must be present in source fields: ${Array.from(availableFields).join(", ")}`,
      allowed_alternatives: Array.from(availableFields).slice(0, 20),
    });
  }

  spec.layout.columns.forEach((column, index) => {
    if (availableFields.size > 0 && !availableFields.has(column.field)) {
      issues.push({
        path: `layout.columns[${index}].field`,
        rule: "unknown_field",
        expected: "Column field must exist in source schema.",
        allowed_alternatives: Array.from(availableFields).slice(0, 20),
      });
    }
    if (!VALID_KINDS.includes(column.kind)) {
      issues.push({
        path: `layout.columns[${index}].kind`,
        rule: "invalid_kind",
        expected: "Column kind must be one of string|number|date.",
        allowed_alternatives: VALID_KINDS,
      });
    }
  });

  return issues;
}

export function isCatalogComponent(componentId: string): boolean {
  return COMPONENT_CATALOG.some((component) => component.id === componentId);
}

export function sanitizeComponentProps(input: {
  component_id: string;
  props?: Record<string, unknown>;
}): { sanitized_props: Record<string, unknown>; stripped_props: string[] } {
  const component = COMPONENT_CATALOG.find((item) => item.id === input.component_id);
  const props = input.props ?? {};
  if (!component) {
    return { sanitized_props: {}, stripped_props: Object.keys(props) };
  }

  const allowed = new Set(component.allowed_props);
  const sanitizedProps: Record<string, unknown> = {};
  const stripped: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (allowed.has(key)) sanitizedProps[key] = value;
    else stripped.push(key);
  }
  return { sanitized_props: sanitizedProps, stripped_props: stripped };
}
