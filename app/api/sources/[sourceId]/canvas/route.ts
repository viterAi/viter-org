import { NextRequest } from "next/server";
import { getSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCatalogPromptBlock } from "../../../../../lib/layout/component-catalog";
import {
  fillPageComponents,
  planPages,
  type AiPageNode,
  type AiPageStatus,
} from "../../../../../lib/ai/page-composer";
import {
  fetchL2RowsForSource,
  l2RowsToSourceDataRows,
  resolveSourceKey,
} from "../../../../../lib/genui/l2-source";

const MAX_PAGE_FILL_ATTEMPTS = 20;

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { sourceId } = await params;
  void request;
  const sourceKey = decodeURIComponent(sourceId);

  const resolved = await resolveSourceKey(supabase, sourceKey);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(data: unknown) {
        controller.enqueue(encoder.encode(sseEvent(data)));
      }

      try {
        if (!resolved) {
          emit({ type: "error", error: `Source not found or not visible: ${sourceKey}` });
          controller.close();
          return;
        }

        const l2Rows = await fetchL2RowsForSource(supabase, resolved);
        const rows = l2RowsToSourceDataRows(l2Rows, resolved.kind);

        const source = {
          key: sourceKey,
          name: resolved.name,
          channel: resolved.kind,
          seed_format: "genui_l2",
        };

        if (rows.length === 0) {
          emit({
            type: "done",
            rows: [],
            ai_pages: [],
            ai_page_statuses: [],
            ai_warnings: [],
            ai_status: {
              state: "ready",
              last_error: null,
              empty_reason: "no_l2_rows",
            },
          });
          controller.close();
          return;
        }

        // ── Stage 1: plan pages ──────────────────────────────────────────────
        emit({ type: "planning" });

        const plan = await planPages({ source, rows });

        if (!plan || plan.length === 0) {
          emit({
            type: "done",
            ai_pages: [],
            ai_page_statuses: [],
            ai_warnings: [],
            ai_status: { state: "plan_failed", last_error: "AI could not produce a page plan." },
          });
          controller.close();
          return;
        }

        emit({ type: "plan_ready", pages: plan.map((p) => ({ id: p.id, title: p.title, description: p.description })) });

        // ── Stage 2: fill each page (in parallel) ───────────────────────────
        const catalogPrompt = getCatalogPromptBlock();

        const pageResults = await Promise.all(
          plan.map(async (pagePlan) => {
            emit({ type: "page_start", page_id: pagePlan.id, title: pagePlan.title, max_attempts: MAX_PAGE_FILL_ATTEMPTS });

            const { components, status } = await fillPageComponents({
              page: pagePlan,
              source,
              rows,
              catalogPrompt,
              maxAttempts: MAX_PAGE_FILL_ATTEMPTS,
              onAttempt: (attempt, error) => {
                emit({ type: "page_attempt", page_id: pagePlan.id, attempt, max_attempts: MAX_PAGE_FILL_ATTEMPTS, last_error: error });
              },
            });

            if (status.state === "ready") {
              emit({ type: "page_done", page_id: pagePlan.id, title: pagePlan.title, components, attempts_used: status.attempts_used });
            } else {
              emit({ type: "page_failed", page_id: pagePlan.id, last_error: status.last_error, attempts_used: status.attempts_used });
            }

            return { pagePlan, components, status };
          }),
        );

        const aiPages: AiPageNode[] = pageResults.map(({ pagePlan, components }) => ({
          id: pagePlan.id,
          title: pagePlan.title,
          description: pagePlan.description,
          components,
        }));
        const aiPageStatuses: AiPageStatus[] = pageResults.map(({ status }) => status);
        const allWarnings: string[] = pageResults.flatMap(({ status }) => status.warnings);
        const anyInvalid = aiPageStatuses.some((s) => s.state === "invalid");

        emit({
          type: "done",
          rows,
          ai_pages: aiPages,
          ai_page_statuses: aiPageStatuses,
          ai_warnings: allWarnings,
          ai_status: {
            state: anyInvalid ? "invalid" : "ready",
            last_error: anyInvalid
              ? aiPageStatuses.filter((s) => s.state === "invalid").map((s) => `Page '${s.page_id}': ${s.last_error}`).join("; ")
              : null,
          },
        });
      } catch (err) {
        emit({ type: "error", error: err instanceof Error ? err.message : "Internal error." });
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
