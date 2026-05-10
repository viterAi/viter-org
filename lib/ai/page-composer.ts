import { z } from "zod";
import type { SourceDataRow } from "../types/view-builder";
import type { SpecNode } from "../types/spec";
import {
  isCatalogComponent,
  sanitizeComponentProps,
} from "../layout/component-catalog";
import { mapAllNodes } from "../view/spec-mapper";

export type AiComponentNode = {
  component_id: string;
  props: Record<string, unknown>;
};

export type AiPagePlan = {
  id: string;
  title: string;
  description: string;
};

export type AiPageNode = {
  id: string;
  title: string;
  description: string;
  components: AiComponentNode[];
};

export type AiPageStatus = {
  page_id: string;
  state: "ready" | "invalid";
  attempts_used: number;
  last_error: string | null;
  warnings: string[];
};

const aiPagePlanSchema = z.object({
  pages: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string(),
    }),
  ),
});

const aiPageComponentsSchema = z.object({
  components: z.array(
    z.object({
      component_id: z.string().min(1),
      props: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

/**
 * Loose schema for abstract ViewSpec nodes produced by the AI.
 * We only enforce the discriminant fields; the mapper handles the rest.
 */
const abstractNodesSchema = z.object({
  nodes: z.array(
    z
      .object({ node_type: z.string().min(1), id: z.string().min(1) })
      .passthrough(),
  ),
});

const ABSTRACT_NODE_EXAMPLE = JSON.stringify(
  {
    nodes: [
      {
        node_type: "metric_summary",
        id: "top_kpis",
        label: "Portfolio snapshot",
        metrics: [
          { key: "amount_cents", label: "Total Outstanding", format: "currency" },
          { key: "overdue_count", label: "Overdue Invoices", format: "number" },
        ],
        mode: "static",
      },
      {
        node_type: "ranked_list",
        id: "overdue_list",
        label: "Overdue — needs action",
        data_source: "invoices",
        row_key: "invoice_id",
        rank_by: "amount_cents",
        rank_direction: "desc",
        fields: [
          { key: "invoice_id", label: "Invoice", format: "text", emphasis: true },
          { key: "client_name", label: "Client", format: "text" },
          { key: "amount_cents", label: "Amount", format: "currency", emphasis: true },
          { key: "due_date", label: "Due", format: "date" },
          { key: "status", label: "Bucket", format: "text" },
        ],
        max_rows: 20,
        mode: "static",
      },
      {
        node_type: "breakdown",
        id: "by_status",
        label: "Outstanding by bucket",
        data_source: "invoices",
        group_by: "status",
        value_field: "amount_cents",
        value_format: "currency",
        max_groups: 4,
        mode: "static",
      },
    ],
  },
  null,
  2,
);

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  return JSON.parse(raw);
}

async function callOpenRouter(messages: Array<{ role: string; content: string }>): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-001";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
    }),
  });

  if (!response.ok) return null;
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? null;
}

// Stage 1: AI decides page plan (titles + descriptions, no components yet)
export async function planPages(input: {
  source: { key: string; name: string; channel?: string; seed_format?: string };
  rows: SourceDataRow[];
}): Promise<AiPagePlan[] | null> {
  const sampleRows = input.rows.slice(0, 20);
  const schemaFields = Array.from(new Set(sampleRows.flatMap((row) => Object.keys(row))));

  const prompt = [
    "You are designing a multi-page dashboard for the given source data.",
    "Plan which pages to create. Return JSON only.",
    'Shape: {"pages":[{"id":"...","title":"...","description":"What this page shows and why"}]}',
    "Rules:",
    "- id must be snake_case",
    "- 1 to 4 pages only",
    "- description should explain the business purpose of the page",
    "- do NOT include components yet, just the plan",
    "",
    `Source name: ${input.source.name}`,
    `Source channel: ${input.source.channel ?? "unknown"}`,
    `Schema fields: ${JSON.stringify(schemaFields)}`,
    `Sample rows: ${JSON.stringify(sampleRows)}`,
  ].join("\n");

  const content = await callOpenRouter([
    { role: "system", content: "You are a strict JSON generator. Output valid JSON only." },
    { role: "user", content: prompt },
  ]);

  if (!content) return null;
  try {
    return aiPagePlanSchema.parse(extractJson(content)).pages;
  } catch {
    return null;
  }
}

// Stage 2: AI fills one page with components, retry up to maxAttempts
export async function fillPageComponents(input: {
  page: AiPagePlan;
  source: { key: string; name: string; channel?: string };
  rows: SourceDataRow[];
  catalogPrompt: string;
  maxAttempts: number;
  /** When set, the AI amends the existing layout rather than starting fresh */
  steerInstruction?: string;
  /** The current components on this page, provided when steering */
  existingComponents?: AiComponentNode[];
  onAttempt?: (attempt: number, error: string | null) => void;
}): Promise<{
  components: AiComponentNode[];
  status: AiPageStatus;
}> {
  const sampleRows = input.rows.slice(0, 20);
  const schemaFields = Array.from(new Set(sampleRows.flatMap((row) => Object.keys(row))));
  const warnings: string[] = [];
  let lastError: string | null = null;
  let feedback = "";

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    input.onAttempt?.(attempt, attempt > 1 ? lastError : null);
    const hasRows = sampleRows.length > 0;
    const isSteer = !!input.steerInstruction;

    // ── Abstract-node path (initial generation) ───────────────────────────
    // Ask the AI for renderer-agnostic ViewSpec nodes; spec-mapper translates
    // them to catalog components afterwards. This keeps the AI prompt decoupled
    // from the concrete renderer catalog.
    //
    // ── Catalog path (steer amendments) ──────────────────────────────────
    // When the user is steering, we keep the catalog format so the AI can
    // reference and amend existing components by component_id.
    // The steer loop will be overhauled in T-007.

    if (!isSteer) {
      const nodeTypes = [
        "metric_summary — key numbers at a glance (maps to kpi_row / metric_card)",
        "ranked_list    — sorted tabular data with optional row actions (maps to data_table / attention_list / entity_cards)",
        "breakdown      — how a total splits across categories (maps to chart_donut / chart_bar)",
        "trend          — value over time (maps to chart_line / activity_feed)",
        "timeline       — tasks/milestones with start+end dates (maps to chart_gantt); use when rows have date fields",
        "text_summary   — narrative prose synthesised from source data (maps to text_block)",
        "filter_controls — filtering dimensions available to the user (maps to filter_bar)",
        "action_panel   — view-level action buttons (maps to action_panel)",
      ];

      const prompt = [
        `Fill this dashboard page with abstract ViewSpec nodes: "${input.page.title}"`,
        `Page description: ${input.page.description}`,
        "",
        "Return JSON only. No markdown, no explanation.",
        'Shape: {"nodes":[{...node...},{...node...}]}',
        "",
        "CRITICAL RULES — violating these will break the dashboard:",
        `1. Every field reference (key, group_by, x_field, y_field, rank_by, title_field, end_field, start_field, status_field, row_key) MUST be an exact name from Schema fields: ${JSON.stringify(schemaFields)}. NEVER invent field names.`,
        "2. For text_summary: write real prose synthesised from the sample rows — include specific names, numbers, and facts from the data. Do not leave content blank.",
        "3. Use only the node_types listed below. Do not invent new ones.",
        "",
        "Available node types:",
        ...nodeTypes,
        "",
        "Node shape rules:",
        "- every node must have: node_type, id (snake_case), mode (\"static\")",
        "- metric_summary: metrics[] with key (must be a schema field), label, format (number|currency|percent|text)",
        "- ranked_list: data_source, row_key, rank_by (schema fields only), fields[] with key+label+format, max_rows (≤10 for short attention lists, ≥6 for tables)",
        "- breakdown: data_source, group_by (categorical schema field), value_field (numeric schema field or empty string for count)",
        "- trend: data_source, x_field (date/timestamp schema field), y_field (numeric schema field)",
        "- timeline: data_source, title_field (name schema field), end_field (date schema field), optionally start_field, status_field",
        "- text_summary: content with 2-4 sentences of actual insight synthesised from the sample rows",
        "- filter_controls: filters[] with field (schema field), label, control (dropdown|date_range|search|toggle)",
        "- action_panel: actions[] with id, label, routing (view_only|write_back|agent)",
        hasRows
          ? "- structured rows exist — ranked_list, breakdown, trend, timeline are all appropriate when the schema fields support them"
          : "- NO structured rows — prefer metric_summary, text_summary, filter_controls, action_panel",
        "",
        "Example output:",
        ABSTRACT_NODE_EXAMPLE,
        "",
        feedback ? `Validation feedback from previous attempt: ${feedback}` : "",
        `Source name: ${input.source.name}`,
        `Schema fields: ${JSON.stringify(schemaFields)}`,
        `Sample rows: ${JSON.stringify(sampleRows)}`,
      ]
        .filter(Boolean)
        .join("\n");

      const content = await callOpenRouter([
        { role: "system", content: "You are a strict JSON generator for abstract dashboard specs. Output valid JSON only." },
        { role: "user", content: prompt },
      ]);

      if (!content) {
        lastError = "AI returned no output.";
        feedback = JSON.stringify([{ path: "nodes", rule: "no_output", expected: "Return valid JSON with nodes array." }]);
        continue;
      }

      let parsed;
      try {
        parsed = abstractNodesSchema.parse(extractJson(content));
      } catch {
        lastError = "AI output was not valid JSON matching required shape.";
        feedback = JSON.stringify([{ path: "nodes", rule: "invalid_json", expected: 'Return {"nodes":[{"node_type":"...","id":"..."}]}' }]);
        continue;
      }

      // Translate abstract nodes → catalog components via spec-mapper
      const mapped = mapAllNodes(parsed.nodes as unknown as SpecNode[]);

      const unknownMapped: Array<{ path: string; component_id: string }> = [];
      const sanitized: AiComponentNode[] = mapped
        .filter((c, i) => {
          if (isCatalogComponent(c.component_id)) return true;
          unknownMapped.push({ path: `nodes[${i}] → ${c.component_id}`, component_id: c.component_id });
          return false;
        })
        .map((c) => {
          const { sanitized_props, stripped_props } = sanitizeComponentProps({
            component_id: c.component_id,
            props: c.props,
          });
          if (stripped_props.length > 0) {
            warnings.push(`Page '${input.page.id}': stripped unsupported props from '${c.component_id}': ${stripped_props.join(", ")}`);
          }
          return { component_id: c.component_id, props: sanitized_props };
        });

      if (unknownMapped.length === 0) {
        return {
          components: sanitized,
          status: { page_id: input.page.id, state: "ready", attempts_used: attempt, last_error: null, warnings },
        };
      }

      lastError = `Spec mapper produced unknown component ids: ${unknownMapped.map((item) => item.component_id).join(", ")}`;
      feedback = JSON.stringify(
        unknownMapped.map((item) => ({ path: item.path, rule: "unknown_component", expected: "Use only supported node_types." })),
      );
      continue;
    }

    // ── Catalog path (steer only) ─────────────────────────────────────────
    const prompt = [
      `Amend this dashboard page based on a user instruction: "${input.page.title}"`,
      `Page description: ${input.page.description}`,
      `User instruction: ${input.steerInstruction}`,
      input.existingComponents
        ? `Current components (amend these — keep what still makes sense, change or add what the instruction requires): ${JSON.stringify(input.existingComponents)}`
        : "",
      "Return JSON only.",
      'Shape: {"components":[{"component_id":"...","props":{}}]}',
      "CRITICAL: Every field reference (group_by, x_field, y_field, title_field, value_field, etc.) MUST be an exact name from Schema fields below. NEVER invent field names.",
      "Rules:",
      "- only use component_ids from catalog",
      "- props must be fully populated with REAL values extracted from the source data below",
      "- for text_block: always set both 'title' and 'body' from actual source content (write real prose with names/numbers)",
      "- for kpi_row: always populate 'metrics' array with label+value pairs; set value to an actual schema field name so the renderer can aggregate it",
      "- for attention_list: set 'label_field' and optionally 'detail_field' to schema field names; set 'max_items' to ≤8; optionally populate 'items' with literal strings from the data",
      "- for activity_feed: populate 'items' array with actual strings from the source",
      "- for metric_card: always set 'label' and 'value' (a schema field name) from real data",
      "- for action_panel: always set 'title' and 'actions' array with {id, label} objects",
      "- for filter_bar: always set 'fields' array to meaningful filter dimensions from schema fields",
      "- for chart_bar / chart_donut: set 'group_by' (categorical schema field) and 'value_field' (numeric schema field)",
      "- for chart_line: set 'x_field' (date schema field) and 'y_field' (numeric schema field)",
      "- for chart_gantt: set 'title_field', 'end_field', optionally 'start_field' and 'status_field' — all schema fields",
      "- for kanban_board: set 'group_by', 'title_field', and 'lanes' matching actual schema fields",
      "- for entity_cards: set 'title_field', 'subtitle_field', 'value_field' matching actual schema fields",
      hasRows
        ? "- data_table, chart_*, kanban_board, entity_cards are all available because structured rows exist"
        : "- DO NOT use data_table, chart_bar, chart_line, chart_donut, kanban_board, or entity_cards — there are NO structured rows for this source; use text_block, kpi_row, attention_list, activity_feed, action_panel, filter_bar, metric_card instead",
      "",
      `Component catalog: ${input.catalogPrompt}`,
      feedback ? `Validation feedback from previous attempt: ${feedback}` : "",
      "",
      `Source name: ${input.source.name}`,
      `Has structured rows: ${hasRows}`,
      `Schema fields: ${JSON.stringify(schemaFields)}`,
      `Sample rows (use these to extract real values for props): ${JSON.stringify(sampleRows)}`,
    ]
      .filter(Boolean)
      .join("\n");

    const content = await callOpenRouter([
      { role: "system", content: "You are a strict JSON generator. Output valid JSON only." },
      { role: "user", content: prompt },
    ]);

    if (!content) {
      lastError = "AI returned no output.";
      feedback = JSON.stringify([{ path: "components", rule: "no_output", expected: "Return valid JSON with components array." }]);
      continue;
    }

    let parsed;
    try {
      parsed = aiPageComponentsSchema.parse(extractJson(content));
    } catch {
      lastError = "AI output was not valid JSON matching required shape.";
      feedback = JSON.stringify([{ path: "components", rule: "invalid_json", expected: 'Return {"components":[{"component_id":"...","props":{}}]}' }]);
      continue;
    }

    const unknownComponents: Array<{ path: string; component_id: string }> = [];
    const sanitized: AiComponentNode[] = parsed.components
      .filter((component, i) => {
        if (isCatalogComponent(component.component_id)) return true;
        unknownComponents.push({ path: `components[${i}].component_id`, component_id: component.component_id });
        return false;
      })
      .map((component) => {
        const { sanitized_props, stripped_props } = sanitizeComponentProps({
          component_id: component.component_id,
          props: component.props as Record<string, unknown> | undefined,
        });
        if (stripped_props.length > 0) {
          warnings.push(`Page '${input.page.id}': stripped unsupported props from '${component.component_id}': ${stripped_props.join(", ")}`);
        }
        return { component_id: component.component_id, props: sanitized_props };
      });

    if (unknownComponents.length === 0) {
      return {
        components: sanitized,
        status: { page_id: input.page.id, state: "ready", attempts_used: attempt, last_error: null, warnings },
      };
    }

    lastError = `Unknown component ids: ${unknownComponents.map((item) => item.component_id).join(", ")}`;
    feedback = JSON.stringify(
      unknownComponents.map((item) => ({
        path: item.path,
        rule: "unknown_component",
        expected: "component_id must be in catalog.",
        allowed_alternatives: ["See catalog for valid ids."],
      })),
    );
  }

  return {
    components: [],
    status: {
      page_id: input.page.id,
      state: "invalid",
      attempts_used: input.maxAttempts,
      last_error: lastError ?? "Page component generation failed.",
      warnings,
    },
  };
}
