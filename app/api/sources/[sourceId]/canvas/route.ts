import { NextRequest } from "next/server";
import type { SourceDataRow } from "../../../../../lib/types/view-builder";
import { getMockMessages } from "../../../../../lib/l0/mock-data";
import { getCatalogPromptBlock } from "../../../../../lib/layout/component-catalog";
import {
  fillPageComponents,
  planPages,
  type AiPageNode,
  type AiPageStatus,
} from "../../../../../lib/ai/page-composer";

const MAX_PAGE_FILL_ATTEMPTS = 20;

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await params;
  void request;

  // sourceId is the chat_slug (e.g. "shaul-direct", "mvp-dev")
  const chatSlug = decodeURIComponent(sourceId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(data: unknown) {
        controller.enqueue(encoder.encode(sseEvent(data)));
      }

      try {
        const rows: SourceDataRow[] = getMockMessages(chatSlug);

        if (rows.length === 0) {
          emit({ type: "error", error: `No messages found for chat: ${chatSlug}` });
          controller.close();
          return;
        }

        const chatName = chatSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const source = {
          key: chatSlug,
          name: chatName,
          channel: "whatsapp",
          seed_format: "whatsapp_chat",
        };

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
