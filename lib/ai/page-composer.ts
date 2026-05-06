import { z } from "zod";
import type { SourceDataRow } from "../types/view-builder";
import {
  isCatalogComponent,
  sanitizeComponentProps,
} from "../layout/component-catalog";

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
    const prompt = [
      `Fill this page with components: "${input.page.title}"`,
      `Page description: ${input.page.description}`,
      "Return JSON only.",
      'Shape: {"components":[{"component_id":"...","props":{}}]}',
      "Rules:",
      "- only use component_ids from catalog",
      "- props must be fully populated with REAL values extracted from the source data below",
      "- for text_block: always set both 'title' and 'body' from actual source content",
      "- for kpi_row: always populate 'metrics' array with label+value pairs using real numbers from the source",
      "- for attention_list / activity_feed: always populate 'items' array with actual strings from the source",
      "- for metric_card: always set 'label' and 'value' from real data",
      "- for action_panel: always set 'title' and 'actions' array",
      "- for filter_bar: always set 'fields' array to meaningful filter dimensions",
      "- for chart_bar / chart_donut: set 'group_by' and 'value_field' matching actual schema fields",
      "- for chart_line: set 'x_field' and 'y_field' matching actual schema fields",
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
      feedback = JSON.stringify([
        {
          path: "components",
          rule: "no_output",
          expected: "Return valid JSON with components array.",
          allowed_alternatives: ["Output JSON only, no markdown."],
        },
      ]);
      continue;
    }

    let parsed;
    try {
      parsed = aiPageComponentsSchema.parse(extractJson(content));
    } catch {
      lastError = "AI output was not valid JSON matching required shape.";
      feedback = JSON.stringify([
        {
          path: "components",
          rule: "invalid_json",
          expected: 'Return {"components":[{"component_id":"...","props":{}}]}',
          allowed_alternatives: ["No prose. No markdown. Only JSON."],
        },
      ]);
      continue;
    }

    const unknownComponents: Array<{ path: string; component_id: string }> = [];
    const sanitized: AiComponentNode[] = parsed.components
      .filter((component, i) => {
        if (isCatalogComponent(component.component_id)) return true;
        unknownComponents.push({
          path: `components[${i}].component_id`,
          component_id: component.component_id,
        });
        return false;
      })
      .map((component) => {
        const { sanitized_props, stripped_props } = sanitizeComponentProps({
          component_id: component.component_id,
          props: component.props as Record<string, unknown> | undefined,
        });
        if (stripped_props.length > 0) {
          warnings.push(
            `Page '${input.page.id}': stripped unsupported props from '${component.component_id}': ${stripped_props.join(", ")}`,
          );
        }
        return { component_id: component.component_id, props: sanitized_props };
      });

    if (unknownComponents.length === 0) {
      return {
        components: sanitized,
        status: {
          page_id: input.page.id,
          state: "ready",
          attempts_used: attempt,
          last_error: null,
          warnings,
        },
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
