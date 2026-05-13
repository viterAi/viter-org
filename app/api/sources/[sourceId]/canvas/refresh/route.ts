/**
 * Content refresh route — keeps the layout intact, updates only dynamic components.
 *
 * A component is eligible for refresh when:
 *   - component.mode === "dynamic", OR
 *   - it belongs to the legacy hardcoded set (text_block, activity_feed) for backward compat.
 *
 * Accepts an optional `trigger` in the request body to limit refresh to components
 * that listen to a specific trigger ("data_change" | "dock_context_change" | "agent_event").
 * When no trigger is given, all eligible dynamic components are refreshed.
 */
import { NextRequest } from "next/server";
import type { ComponentTrigger } from "../../../../../types";
import { getSupabaseServerClient } from "../../../../../../lib/supabase/server";
import {
  fetchL2RowsForSource,
  l2RowsToSourceDataRows,
  resolveSourceKey,
} from "../../../../../../lib/genui/l2-source";

/** Backward-compat fallback: treat these component IDs as dynamic even without mode field. */
const LEGACY_DYNAMIC_COMPONENTS = new Set(["text_block", "activity_feed"]);

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function callOpenRouter(messages: Array<{ role: string; content: string }>): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-001";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.3 }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? null;
}

type AiComponent = {
  component_id: string;
  props?: Record<string, unknown>;
  mode?: "static" | "dynamic";
  trigger?: ComponentTrigger;
};
type AiPage = { id: string; title: string; description?: string; components: AiComponent[] };

async function refreshTextBlock(
  component: AiComponent,
  context: { sourceName: string; dataContext: string; pageTitle: string },
): Promise<AiComponent> {
  const existingBody = (component.props?.body as string) ?? "";
  const existingTitle = (component.props?.title as string) ?? "";

  const prompt = [
    `You are refreshing a summary text block for a dashboard page titled "${context.pageTitle}".`,
    `Source: ${context.sourceName}`,
    "",
    "Current data snapshot:",
    context.dataContext,
    "",
    `The existing block title is: "${existingTitle}"`,
    `The existing block body is: "${existingBody}"`,
    "",
    "Rewrite the body text to reflect the current data. Keep the same tone and length (1-3 sentences).",
    "Return JSON only: { \"body\": \"<updated text>\" }",
  ].join("\n");

  const content = await callOpenRouter([
    { role: "system", content: "You are a concise dashboard copywriter. Return valid JSON only." },
    { role: "user", content: prompt },
  ]);

  if (!content) return component;

  try {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fenced?.[1] ?? content;
    const parsed = JSON.parse(raw) as { body?: string };
    if (parsed.body) {
      return { ...component, props: { ...component.props, body: parsed.body } };
    }
  } catch { /* keep original */ }
  return component;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { sourceId } = await params;
  const body = (await request.json()) as { pages: AiPage[]; trigger?: ComponentTrigger };
  const pages: AiPage[] = body.pages ?? [];
  const triggerFilter: ComponentTrigger | undefined = body.trigger;

  const sourceKey = decodeURIComponent(sourceId);
  const resolved = await resolveSourceKey(supabase, sourceKey);
  const l2Rows = resolved ? await fetchL2RowsForSource(supabase, resolved) : [];
  const rows = resolved ? l2RowsToSourceDataRows(l2Rows, resolved.kind) : [];
  const sourceName = resolved?.name ?? sourceKey;
  const dataContext = rows.length > 0
    ? `${rows.length} L2 syntheses (newest first). Sample:\n${JSON.stringify(rows.slice(0, 15), null, 1)}`
    : "No data available.";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(data: unknown) {
        controller.enqueue(encoder.encode(sseEvent(data)));
      }

      try {
        const updatedPages: AiPage[] = [];

        for (const page of pages) {
          const updatedComponents: AiComponent[] = [];
          let pageChanged = false;

          for (const component of page.components) {
            const isDynamic =
              component.mode === "dynamic" ||
              LEGACY_DYNAMIC_COMPONENTS.has(component.component_id);

            // Skip if trigger filter is set and this component doesn't match.
            // Components without a trigger field default to "data_change" behaviour.
            const componentTrigger = component.trigger ?? "data_change";
            const triggerMatches = !triggerFilter || componentTrigger === triggerFilter;

            if (isDynamic && triggerMatches) {
              emit({ type: "refreshing_component", page_id: page.id, component_id: component.component_id });
              const updated = await refreshTextBlock(component, { sourceName, dataContext, pageTitle: page.title });
              updatedComponents.push(updated);
              if (updated !== component) pageChanged = true;
            } else {
              updatedComponents.push(component);
            }
          }

          updatedPages.push({ ...page, components: updatedComponents });
          if (pageChanged) {
            emit({ type: "page_refreshed", page_id: page.id, components: updatedComponents });
          }
        }

        emit({
          type: "done",
          ai_pages: updatedPages,
          ai_status: { state: "ready", last_error: null },
        });
      } catch (err) {
        emit({ type: "error", error: err instanceof Error ? err.message : "Refresh failed." });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
