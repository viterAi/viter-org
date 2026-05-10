/**
 * Spec Mapper — thin translation layer from abstract spec nodes to component IDs.
 *
 * The spec describes WHAT to communicate; this layer decides HOW to render it.
 * Swapping a component only requires changing this file, not the spec or the AI prompt.
 */

import type {
  SpecNode,
  MetricSummaryNode,
  RankedListNode,
  BreakdownNode,
  TrendNode,
  TimelineNode,
} from "../types/spec";

export interface MappedComponent {
  /** Component ID from the catalog */
  component_id: string;
  /** Props derived from the spec node */
  props: Record<string, unknown>;
  /** The original spec node id, for Steer targeting */
  spec_node_id: string;
}

/**
 * Maps a single spec node to a concrete component + props.
 * Returns null for node types that have their own dedicated renderer
 * (e.g. sequence_item, which uses a custom sequential card, not the catalog).
 */
export function mapSpecNode(node: SpecNode): MappedComponent | null {
  switch (node.node_type) {
    case "metric_summary":
      return mapMetricSummary(node);
    case "ranked_list":
      return mapRankedList(node);
    case "breakdown":
      return mapBreakdown(node);
    case "trend":
      return mapTrend(node);
    case "timeline":
      return mapTimeline(node);
    case "text_summary":
      return {
        component_id: "text_block",
        props: { title: node.label, body: node.content },
        spec_node_id: node.id,
      };
    case "filter_controls":
      return {
        component_id: "filter_bar",
        props: {
          title: node.label,
          fields: node.filters.map((f) => ({ field: f.field, label: f.label, control: f.control })),
        },
        spec_node_id: node.id,
      };
    case "action_panel":
      return {
        component_id: "action_panel",
        props: { title: node.label, actions: node.actions.map((a) => ({ id: a.id, label: a.label })) },
        spec_node_id: node.id,
      };
    case "sequence_item":
      // Handled by the sequential view renderer directly — not a catalog component.
      return null;
    default: {
      const _exhaustive: never = node;
      void _exhaustive;
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-node mapping helpers
// ---------------------------------------------------------------------------

function mapMetricSummary(node: MetricSummaryNode): MappedComponent {
  // ≤3 metrics → single metric_card row; >3 → kpi_row strip
  const component_id = node.metrics.length <= 3 ? "metric_card" : "kpi_row";

  const metrics = node.metrics.map((m) => ({
    label: m.label,
    value: m.key,       // renderer resolves to actual data at render time
    trend_key: m.trend_key,
    format: m.format ?? "text",
  }));

  return {
    component_id,
    props: { label: node.label, metrics },
    spec_node_id: node.id,
  };
}

function mapRankedList(node: RankedListNode): MappedComponent {
  const hasActions = node.row_actions && node.row_actions.length > 0;
  const isShortList = (node.max_rows ?? Infinity) <= 5;
  const hasEmphasis = node.fields.some((f) => f.emphasis);

  let component_id: string;
  if (hasActions) {
    component_id = "data_table";
  } else if (isShortList) {
    component_id = "attention_list";
  } else if (hasEmphasis && !hasActions) {
    component_id = "entity_cards";
  } else {
    component_id = "data_table";
  }

  const columns = node.fields.map((f) => ({
    id: f.key,
    field: f.key,
    label: f.label,
    kind: deriveColumnKind(f.format),
  }));

  // For attention_list: expose which fields to use for row labels/details
  const emphasisField = node.fields.find((f) => f.emphasis);
  const labelField = emphasisField?.key ?? node.fields[0]?.key;
  const detailField = node.fields.find((f) => f !== emphasisField && f.key !== labelField)?.key;

  return {
    component_id,
    props: {
      title: node.label,
      row_key: node.row_key,
      columns,
      label_field: labelField,
      detail_field: detailField,
      rank_by: node.rank_by,
      rank_direction: node.rank_direction ?? "desc",
      max_items: node.max_rows,
      actions: node.row_actions?.map((a) => ({ id: a.id, label: a.label })),
    },
    spec_node_id: node.id,
  };
}

function mapBreakdown(node: BreakdownNode): MappedComponent {
  // ≤5 groups → donut (composition feel); >5 → bar (easier to read many categories)
  const maxGroups = node.max_groups ?? Infinity;
  const component_id = maxGroups <= 5 ? "chart_donut" : "chart_bar";

  return {
    component_id,
    props: {
      title: node.label,
      group_by: node.group_by,
      value_field: node.value_field,
    },
    spec_node_id: node.id,
  };
}

function mapTimeline(node: TimelineNode): MappedComponent {
  return {
    component_id: "chart_gantt",
    props: {
      title: node.label,
      title_field: node.title_field,
      start_field: node.start_field,
      end_field: node.end_field,
      status_field: node.status_field,
      max_items: node.max_rows,
    },
    spec_node_id: node.id,
  };
}

function mapTrend(node: TrendNode): MappedComponent {
  // Date x-axis → line chart (temporal); otherwise activity feed
  const isTimeSeries = node.x_field.includes("date") || node.x_field.includes("at");
  const component_id = isTimeSeries ? "chart_line" : "activity_feed";

  return {
    component_id,
    props: {
      title: node.label,
      x_field: node.x_field,
      y_field: node.y_field,
    },
    spec_node_id: node.id,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function deriveColumnKind(
  format: string | undefined,
): "string" | "number" | "date" {
  if (!format) return "string";
  if (format === "date") return "date";
  if (
    format === "number" ||
    format === "currency" ||
    format === "percent" ||
    format === "duration"
  )
    return "number";
  return "string";
}

/**
 * Maps all nodes in a spec to their concrete components.
 * Nodes that use dedicated renderers (sequence_item) are omitted.
 */
export function mapAllNodes(nodes: SpecNode[]): MappedComponent[] {
  return nodes.flatMap((node) => {
    const mapped = mapSpecNode(node);
    return mapped ? [mapped] : [];
  });
}
