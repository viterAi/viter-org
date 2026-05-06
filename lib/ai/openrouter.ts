import { z } from "zod";
import type { PersistedViewSpec, SourceDataRow } from "../types/view-builder";

const aiColumnSchema = z.object({
  id: z.string().min(1),
  field: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["string", "number", "date"]),
});

const aiSpecSchema = z.object({
  layout: z.object({
    spec_version: z.number().int().positive(),
    generator: z.enum(["openrouter_ai", "deterministic_fallback"]),
    component_id: z.string().min(1),
    row_key: z.string().min(1),
    columns: z.array(aiColumnSchema).min(1).max(10),
  }),
});

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  return JSON.parse(raw);
}

export async function generateTableSpecWithOpenRouter(input: {
  source: { key: string; name: string; channel?: string; seed_format?: string };
  rows: SourceDataRow[];
  catalogPrompt: string;
  validationFeedback?: string;
}): Promise<PersistedViewSpec | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-001";
  const sampleRows = input.rows.slice(0, 20);
  const schemaFields = Array.from(
    new Set(sampleRows.flatMap((row) => Object.keys(row))),
  );

  const prompt = [
    "Generate a table dashboard spec JSON for this source using the fixed component catalog.",
    "Return JSON only. No markdown, no explanation.",
    "Use this strict shape:",
    '{"layout":{"spec_version":1,"generator":"openrouter_ai","component_id":"data_table","row_key":"...","columns":[{"id":"...","field":"...","label":"...","kind":"string|number|date"}]}}',
    "Rules:",
    "- only use components listed in catalog",
    "- max 10 columns",
    "- prefer business-important fields first",
    "- row_key should be stable identifier like invoice_id/id",
    "",
    `Component catalog: ${input.catalogPrompt}`,
    input.validationFeedback
      ? `Validation feedback from previous attempt: ${input.validationFeedback}`
      : "",
    "",
    `Source name: ${input.source.name}`,
    `Source key: ${input.source.key}`,
    `Source channel: ${input.source.channel ?? "unknown"}`,
    `Seed format: ${input.source.seed_format ?? "unknown"}`,
    `Schema fields: ${JSON.stringify(schemaFields)}`,
    `Sample rows: ${JSON.stringify(sampleRows)}`,
  ].join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a strict JSON generator for dashboard table specs. Output valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) return null;
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = aiSpecSchema.parse(extractJson(content));
    return parsed;
  } catch {
    return null;
  }
}
