import { NextRequest } from "next/server";
import { getMockMessages, getMockChats } from "../../../../../lib/l0/mock-data";
import { getCatalogPromptBlock } from "../../../../../lib/layout/component-catalog";
import {
  fillPageComponents,
  type AiComponentNode,
  type AiPageNode,
  type AiPageStatus,
} from "../../../../../lib/ai/page-composer";
import { fetchData } from "../../../../../lib/ai/fetch-data";
import type { SourceDataRow } from "../../../../../lib/types/view-builder";

const MAX_PAGE_FILL_ATTEMPTS = 20;

type SteerRoute = "spec" | "tom" | "query" | "navigate";

type ClassifierResult =
  | { route: "spec"; instruction: string; affected_page_ids: string[] }
  | { route: "tom"; instruction: string }
  | { route: "query"; instruction: string }
  | { route: "navigate"; target: "page" | "source"; id: string };

type IncomingPage = {
  id: string;
  title: string;
  description?: string;
  components: Array<{ component_id: string; props?: Record<string, unknown> }>;
};

type IncomingSource = { id: string; name: string; key: string };

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function callOpenRouter(
  messages: Array<{ role: string; content: string }>,
): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-001";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? null;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  return JSON.parse(raw);
}

async function classifyMessage(input: {
  message: string;
  pages: IncomingPage[];
  sources: IncomingSource[];
}): Promise<ClassifierResult | null> {
  // Include ordinal position so "page 2" / "page 3" resolves by number
  const pageSummary = input.pages.map((p, i) => ({ position: i + 1, id: p.id, title: p.title }));
  const sourceSummary = input.sources.map((s) => ({ id: s.id, name: s.name, key: s.key }));

  const prompt = [
    "You are a routing classifier for a dashboard assistant.",
    "Classify the user message into exactly one route:",
    "",
    '  "spec"     — user wants to add, remove, change, or reorganise dashboard content.',
    '               Return: {"route":"spec","instruction":"<what to do>","affected_page_ids":["<id>",...]}',
    '               affected_page_ids = all page ids if change is global.',
    "",
    '  "tom"      — user expresses a persistent personal preference (e.g. "I always want...", "I prefer...").',
    '               Return: {"route":"tom","instruction":"<preference to remember>"}',
    "",
    '  "query"    — user is asking a question about data (e.g. "what is the total?", "how many overdue?").',
    '               Return: {"route":"query","instruction":"<the question to answer>"}',
    "",
    '  "navigate" — user wants to switch to a different page tab or source.',
    '               Pages are listed with a "position" number — use it to resolve ordinal references like "page 2" or "third tab".',
    '               Return: {"route":"navigate","target":"page"|"source","id":"<exact id from lists below>"}',
    '               IMPORTANT: "page" means a tab within the current source. "source" means switching to a different source.',
    '               If the user says "page 3" or "go to tab 2", that is ALWAYS target:"page", never target:"source".',
    "",
    "Return JSON only. No prose.",
    "",
    `User message: ${input.message}`,
    `Current page tabs (with position numbers): ${JSON.stringify(pageSummary)}`,
    `Available sources: ${JSON.stringify(sourceSummary)}`,
  ].join("\n");

  const content = await callOpenRouter([
    { role: "system", content: "You are a strict JSON classifier. Output valid JSON only." },
    { role: "user", content: prompt },
  ]);

  if (!content) return null;
  try {
    return extractJson(content) as ClassifierResult;
  } catch {
    return null;
  }
}

type Confidence = "high" | "medium" | "low";

type AnswerAttempt = {
  answer: string;
  confidence: Confidence;
  reasoning: string;
};

/** Flatten all component props from all pages into a compact text block */
function extractPageContext(pages: IncomingPage[]): string {
  const lines: string[] = [];
  for (const page of pages) {
    lines.push(`[Page: ${page.title}]`);
    for (const component of page.components) {
      const props = component.props ?? {};
      // Only include props that carry data values (skip field/key config props)
      const dataProps = Object.entries(props).filter(([k]) =>
        ["metrics", "items", "value", "label", "title", "body", "actions"].includes(k),
      );
      if (dataProps.length > 0) {
        lines.push(`  ${component.component_id}: ${JSON.stringify(Object.fromEntries(dataProps))}`);
      }
    }
  }
  return lines.join("\n");
}

async function attemptAnswer(input: {
  question: string;
  sourceName: string;
  dataContext: string;
}): Promise<AnswerAttempt> {
  const prompt = [
    "You are a data analyst answering a question about a dashboard source.",
    "Answer concisely (1-3 sentences). Use real numbers from the data where possible.",
    "Also rate your confidence: high (data directly answers the question), medium (partial data), low (data insufficient).",
    "Return JSON only.",
    'Shape: {"answer":"<plain English answer>","confidence":"high"|"medium"|"low","reasoning":"<one sentence why>"}',
    "",
    `Source: ${input.sourceName}`,
    input.dataContext,
    "",
    `Question: ${input.question}`,
  ].join("\n");

  const content = await callOpenRouter([
    { role: "system", content: "You are a strict JSON generator. Output valid JSON only." },
    { role: "user", content: prompt },
  ]);

  if (!content) return { answer: "I couldn't compute an answer from the available data.", confidence: "low", reasoning: "No LLM response." };

  try {
    const parsed = extractJson(content) as AnswerAttempt;
    return {
      answer: parsed.answer ?? content,
      confidence: (["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low") as Confidence,
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    // LLM returned plain text instead of JSON — treat it as a medium-confidence answer
    return { answer: content, confidence: "medium", reasoning: "Plain text response." };
  }
}

async function answerQuery(input: {
  question: string;
  rows: SourceDataRow[];
  sourceName: string;
  currentPages: IncomingPage[];
}): Promise<string> {

  // ── Step 1: try from source rows ─────────────────────────────────────────
  const rowsContext = input.rows.length > 0
    ? `Source rows (${input.rows.length} total, showing up to 30):\n${JSON.stringify(input.rows.slice(0, 30))}`
    : "No structured rows available for this source.";

  const attempt1 = await attemptAnswer({
    question: input.question,
    sourceName: input.sourceName,
    dataContext: rowsContext,
  });

  if (attempt1.confidence === "high") return attempt1.answer;

  // ── Step 2: add page component props (computed KPIs, lists, aggregates) ──
  const pageContext = extractPageContext(input.currentPages);
  const combinedContext = [rowsContext, pageContext ? `\nComputed page data:\n${pageContext}` : ""].join("");

  const attempt2 = await attemptAnswer({
    question: input.question,
    sourceName: input.sourceName,
    dataContext: combinedContext,
  });

  if (attempt2.confidence === "high") return attempt2.answer;

  // ── Step 3: call MCP data server ─────────────────────────────────────────
  const mcpResult = await fetchData({ question: input.question });
  if (mcpResult) {
    const mcpContext = [combinedContext, `\nExternal data server result:\n${mcpResult.markdown}`].join("");
    const attempt3 = await attemptAnswer({
      question: input.question,
      sourceName: input.sourceName,
      dataContext: mcpContext,
    });
    return attempt3.answer;
  }

  // Return best attempt — prefer medium over low
  return attempt2.confidence !== "low" ? attempt2.answer : attempt1.answer;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> },
) {
  const { sourceId } = await params;

  const body = (await request.json()) as {
    message: string;
    currentPages: IncomingPage[];
  };

  const { message, currentPages = [] } = body;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(data: unknown) {
        controller.enqueue(encoder.encode(sseEvent(data)));
      }

      try {
        const chatSlug = decodeURIComponent(sourceId);
        const rows = getMockMessages(chatSlug);

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
        };

        const sources: IncomingSource[] = getMockChats().map((c) => ({ id: c.id, name: c.name, key: c.key }));

        // ── Step 1: classify ────────────────────────────────────────────────
        emit({ type: "planning" });

        const classification = await classifyMessage({ message, pages: currentPages, sources });

        if (!classification) {
          emit({ type: "error", error: "Could not classify your message. Try rephrasing." });
          controller.close();
          return;
        }

        // ── Route: navigate ─────────────────────────────────────────────────
        if (classification.route === "navigate") {
          emit({
            type: "navigate",
            target: classification.target,
            id: classification.id,
          });
          emit({ type: "done", ai_pages: currentPages, ai_status: { state: "ready", last_error: null }, ai_page_statuses: [], ai_warnings: [] });
          controller.close();
          return;
        }

        // ── Route: query ────────────────────────────────────────────────────
        if (classification.route === "query") {
          const answer = await answerQuery({
            question: classification.instruction,
            rows,
            sourceName: source.name,
            currentPages,
          });
          emit({ type: "query_answer", answer });
          emit({ type: "done", ai_pages: currentPages, ai_status: { state: "ready", last_error: null }, ai_page_statuses: [], ai_warnings: [] });
          controller.close();
          return;
        }

        // ── Route: tom ──────────────────────────────────────────────────────
        if (classification.route === "tom") {
          emit({
            type: "done",
            tom_noted: true,
            instruction: classification.instruction,
            ai_pages: currentPages,
            ai_page_statuses: currentPages.map((p) => ({
              page_id: p.id,
              state: "ready",
              attempts_used: 0,
              last_error: null,
              warnings: [],
            })),
            ai_warnings: [],
            ai_status: { state: "ready", last_error: null },
          });
          controller.close();
          return;
        }

        // ── Route: spec regeneration ────────────────────────────────────────
        const specResult = classification as { route: "spec"; instruction: string; affected_page_ids: string[] };
        const affectedIds = new Set(specResult.affected_page_ids ?? []);
        const affectAll = affectedIds.size === 0;

        const pagePlans = currentPages.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description ?? "",
        }));

        emit({
          type: "plan_ready",
          pages: pagePlans.map((p) => ({ id: p.id, title: p.title, description: p.description })),
        });

        const catalogPrompt = getCatalogPromptBlock();
        const aiPages: AiPageNode[] = [];
        const aiPageStatuses: AiPageStatus[] = [];
        const allWarnings: string[] = [];

        for (const pagePlan of pagePlans) {
          const isAffected = affectAll || affectedIds.has(pagePlan.id);

          if (!isAffected) {
            const existing = currentPages.find((p) => p.id === pagePlan.id);
            const components = (existing?.components ?? []) as AiComponentNode[];
            aiPages.push({ id: pagePlan.id, title: pagePlan.title, description: pagePlan.description, components });
            aiPageStatuses.push({ page_id: pagePlan.id, state: "ready", attempts_used: 0, last_error: null, warnings: [] });
            emit({ type: "page_done", page_id: pagePlan.id, title: pagePlan.title, components, attempts_used: 0 });
            continue;
          }

          emit({ type: "page_start", page_id: pagePlan.id, title: pagePlan.title, max_attempts: MAX_PAGE_FILL_ATTEMPTS });

          const existingPage = currentPages.find((p) => p.id === pagePlan.id);

          const { components, status } = await fillPageComponents({
            page: pagePlan,
            source,
            rows,
            catalogPrompt,
            maxAttempts: MAX_PAGE_FILL_ATTEMPTS,
            steerInstruction: specResult.instruction,
            existingComponents: existingPage?.components as AiComponentNode[] | undefined,
            onAttempt: (attempt, error) => {
              emit({ type: "page_attempt", page_id: pagePlan.id, attempt, max_attempts: MAX_PAGE_FILL_ATTEMPTS, last_error: error });
            },
          });

          if (status.state === "ready") {
            emit({ type: "page_done", page_id: pagePlan.id, title: pagePlan.title, components, attempts_used: status.attempts_used });
          } else {
            emit({ type: "page_failed", page_id: pagePlan.id, last_error: status.last_error, attempts_used: status.attempts_used });
          }

          aiPages.push({ id: pagePlan.id, title: pagePlan.title, description: pagePlan.description, components });
          aiPageStatuses.push(status);
          allWarnings.push(...status.warnings);
        }

        const anyInvalid = aiPageStatuses.some((s) => s.state === "invalid");

        emit({
          type: "done",
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
