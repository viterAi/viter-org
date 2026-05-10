"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import type { Row, View, Draft, AiPage, AiPageStatus, AiStatus, ProgressStep, Source, ComponentTrigger } from "../types";
import { STEER_HINTS } from "../utils";

function lsTabKey(srcId: string) { return `gui:tab:${srcId}`; }
function readTab(srcId: string): string | null {
  try { return localStorage.getItem(lsTabKey(srcId)); } catch { return null; }
}
function writeTab(srcId: string, pageId: string) {
  try { localStorage.setItem(lsTabKey(srcId), pageId); } catch { /* ignore */ }
}

interface UseCanvasOptions {
  sourceId: string;
  sources: Source[];
  setSourceId: (id: string) => void;
  setBusy: (msg: string) => void;
}

export function useCanvas({ sourceId, sources, setSourceId, setBusy }: UseCanvasOptions) {
  const [views, setViews] = useState<View[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>("");
  const [savedViewId, setSavedViewId] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [isRefreshingContent, setIsRefreshingContent] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [canvasError, setCanvasError] = useState<string>("");
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: "ready", last_error: null });
  const [aiPages, setAiPages] = useState<AiPage[]>([]);
  const [aiPageStatuses, setAiPageStatuses] = useState<AiPageStatus[]>([]);
  const [activeAiPageId, setActiveAiPageId] = useState<string>("");
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [progressLog, setProgressLog] = useState<ProgressStep[]>([]);

  const [refreshingComponentIds, setRefreshingComponentIds] = useState<Set<string>>(new Set());

  // Always-current ref so refreshDynamic() never closes over stale aiPages.
  const aiPagesRef = useRef<AiPage[]>([]);
  aiPagesRef.current = aiPages;

  const [saveError, setSaveError] = useState<string>("");

  const [steerMessages, setSteerMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [steerInput, setSteerInput] = useState("");
  const [steering, setSteering] = useState(false);
  const [steerHintIdx, setSteerHintIdx] = useState(0);
  const steerScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!steering) return;
    setSteerHintIdx(0);
    const id = setInterval(() => setSteerHintIdx((n) => (n + 1) % STEER_HINTS.length), 3000);
    return () => clearInterval(id);
  }, [steering]);

  useEffect(() => {
    for (const w of aiWarnings) console.warn("[ai-layout]", w);
  }, [aiWarnings]);

  /**
   * runContentRefresh — re-fetches content for dynamic components matching a given trigger.
   *
   * Keeps the layout (static components) intact. Only components with
   * mode === "dynamic" (or the legacy text_block / activity_feed IDs) whose
   * trigger matches are sent to the AI for a content update.
   *
   * @param srcId     The source whose refresh route to call.
   * @param pages     Current AiPages to pass to the route.
   * @param trigger   Which trigger to refresh ("data_change" | "dock_context_change").
   */
  async function runContentRefresh(srcId: string, pages: AiPage[], trigger: ComponentTrigger) {
    const hasDynamic = pages.some((p) =>
      p.components.some(
        (c) => c.mode === "dynamic" || ["text_block", "activity_feed"].includes(c.component_id),
      ),
    );
    if (!hasDynamic) return;

    setIsRefreshingContent(true);
    try {
      const refreshRes = await fetch(`/api/sources/${srcId}/canvas/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pages, trigger }),
      });
      if (refreshRes.ok && refreshRes.body) {
        const reader = refreshRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            let event: Record<string, unknown>;
            try { event = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
            if (event.type === "refreshing_component") {
              const cid = event.component_id as string;
              setRefreshingComponentIds((prev) => new Set([...prev, cid]));
            }
            if (event.type === "page_refreshed") {
              const page_id = event.page_id as string;
              const components = event.components as AiPage["components"];
              setAiPages((prev) => prev.map((p) => p.id === page_id ? { ...p, components } : p));
            }
            if (event.type === "done" && event.ai_pages) {
              setAiPages(event.ai_pages as AiPage[]);
            }
          }
        }
      }
    } catch { /* content refresh is best-effort */ }
    setIsRefreshingContent(false);
    setRefreshingComponentIds(new Set());
  }

  /**
   * refreshDynamic — public API to fire any trigger from outside the hook.
   *
   * Calls runContentRefresh with the current aiPages snapshot for the active source.
   * Safe to call from anywhere (Dock, Murmur, agent events) without stale-closure issues.
   *
   * @param trigger  "data_change" | "dock_context_change" | "agent_event"
   */
  const refreshDynamic = useCallback(
    (trigger: ComponentTrigger) => {
      if (!sourceId || aiPagesRef.current.length === 0) return;
      void runContentRefresh(sourceId, aiPagesRef.current, trigger);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceId],
  );

  /**
   * loadOrGenerate — the main entry point when a source is selected.
   * 1. Check for a saved default view with aiPages in the spec.
   * 2. If found: load it immediately (no AI for structure), then refresh dynamic text content.
   * 3. If not found: run full AI generation.
   */
  async function loadOrGenerate(selectedSourceId: string) {
    if (!selectedSourceId) return;
    setCanvasError("");
    setSaveError("");
    setProgressLog([]);

    // ── Step 1: check for a saved view ──────────────────────────────────────
    const viewsRes = await fetch(`/api/sources/${selectedSourceId}/views`);
    if (viewsRes.ok) {
      const viewsJson = (await viewsRes.json()) as { views?: Array<{ id: string; spec?: { ai_pages?: AiPage[] }; is_default?: boolean }> };
      const defaultView = viewsJson.views?.find((v) => v.is_default && v.spec?.ai_pages && v.spec.ai_pages.length > 0);

      if (defaultView?.spec?.ai_pages) {
        const savedPages = defaultView.spec.ai_pages;
        setAiPages(savedPages);
        const persistedTab = readTab(selectedSourceId);
        const restoredTab = savedPages.find((p) => p.id === persistedTab)?.id ?? savedPages[0]?.id ?? "";
        setActiveAiPageId(restoredTab);
        setAiStatus({ state: "ready", last_error: null });
        setAiPageStatuses(savedPages.map((p) => ({ page_id: p.id, state: "ready" as const, attempts_used: 0, last_error: null, warnings: [] })));
        setIsSaved(true);
        setSavedViewId(defaultView.id);

        // Hydrate rows so row-dependent components (charts, tables, activity feeds)
        // have data even when restored from a saved layout without a full AI run.
        try {
          const rowsRes = await fetch(`/api/sources/${selectedSourceId}/invoices`);
          if (rowsRes.ok) {
            const rowsJson = (await rowsRes.json()) as { invoices?: Row[] };
            if (rowsJson.invoices) setRows(rowsJson.invoices);
          }
        } catch { /* rows are best-effort; layout still renders static components */ }

        // ── Step 2: refresh dynamic components whose trigger is data_change ──
        void runContentRefresh(selectedSourceId, savedPages, "data_change");
        return;
      }
    }

    // ── Step 3: no saved view — run full AI generation ───────────────────────
    setIsSaved(false);
    setSavedViewId(null);
    await fetchCanvas(selectedSourceId);
  }

  async function saveLayout(selectedSourceId: string, pages?: AiPage[], existingSavedViewId?: string | null): Promise<boolean> {
    const pagesToSave = pages ?? aiPages;
    const viewId = existingSavedViewId !== undefined ? existingSavedViewId : savedViewId;
    if (!selectedSourceId || pagesToSave.length === 0) return false;
    setIsSavingLayout(true);
    let success = false;
    try {
      if (viewId) {
        // Update existing view's spec
        const updateRes = await fetch(`/api/views/${viewId}/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            summary: "Saved layout from AI generation.",
            spec: { ai_pages: pagesToSave },
          }),
        });
        if (!updateRes.ok) throw new Error(`Update failed: ${updateRes.status}`);
        setIsSaved(true);
        success = true;
      } else {
        // Create new default view
        const res = await fetch(`/api/sources/${selectedSourceId}/views`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            viewName: "Default",
            viewType: "spatial",
            aiPages: pagesToSave,
            isDefault: true,
          }),
        });
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
        const json = (await res.json()) as { view?: { id: string } };
        if (json.view?.id) setSavedViewId(json.view.id);
        setIsSaved(true);
        success = true;
      }
    } catch (err) {
      console.error("[saveLayout]", err);
      setSaveError("Failed to save layout. Please try again.");
    }
    setIsSavingLayout(false);
    return success;
  }

  async function regenerate(selectedSourceId: string) {
    const currentViewId = savedViewId;
    setIsSaved(false);
    await fetchCanvas(selectedSourceId, currentViewId);
  }

  async function fetchCanvas(selectedSourceId: string, autoSaveViewId?: string | null) {
    if (!selectedSourceId) return;
    setGenerating(true);
    setCanvasError("");
    setSaveError("");
    setProgressLog([]);
    setAiPages([]);
    setAiPageStatuses([]);
    setAiWarnings([]);
    setRows([]);

    const res = await fetch(`/api/sources/${selectedSourceId}/canvas`);
    if (!res.ok || !res.body) {
      const errorText = await res.text().catch(() => "");
      setCanvasError(errorText || "Failed to connect to canvas API.");
      setAiStatus({ state: "invalid", last_error: errorText || null });
      setGenerating(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        let event: Record<string, unknown>;
        try { event = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }

        const eventType = event.type as string;
        setProgressLog((prev) => [...prev, event as ProgressStep]);

        if (eventType === "plan_ready") {
          const pages = (event.pages as Array<{ id: string; title: string; description: string }>) ?? [];
          setAiPages(pages.map((p) => ({ id: p.id, title: p.title, description: p.description, components: [] })));
          setActiveAiPageId((cur) => cur || pages[0]?.id || "");
        }
        if (eventType === "page_done") {
          const page_id = event.page_id as string;
          const components = (event.components as AiPage["components"]) ?? [];
          setAiPages((prev) => prev.map((p) => p.id === page_id ? { ...p, components } : p));
          setAiPageStatuses((prev) => {
            if (prev.find((s) => s.page_id === page_id)) return prev;
            return [...prev, { page_id, state: "ready", attempts_used: (event.attempts_used as number) ?? 1, last_error: null, warnings: [] }];
          });
        }
        if (eventType === "page_failed") {
          const page_id = event.page_id as string;
          setAiPageStatuses((prev) => {
            const existing = prev.find((s) => s.page_id === page_id);
            if (existing) return prev.map((s) => s.page_id === page_id ? { ...s, state: "invalid" as const, last_error: (event.last_error as string) ?? null } : s);
            return [...prev, { page_id, state: "invalid", attempts_used: (event.attempts_used as number) ?? 20, last_error: (event.last_error as string) ?? null, warnings: [] }];
          });
        }
        if (eventType === "done") {
          const d = event as { rows?: Row[]; ai_status?: AiStatus; ai_pages?: AiPage[]; ai_page_statuses?: AiPageStatus[]; ai_warnings?: string[] };
          if (d.rows) setRows(d.rows);
          if (d.ai_status) setAiStatus(d.ai_status);
          if (d.ai_pages) {
            setAiPages(d.ai_pages);
            setActiveAiPageId((cur) => {
              const pages = d.ai_pages!;
              const persisted = readTab(selectedSourceId);
              if (persisted && pages.some((p) => p.id === persisted)) return persisted;
              return cur && pages.some((p) => p.id === cur) ? cur : pages[0]?.id ?? "";
            });
            // Auto-save generated layout so it persists across refreshes
            void saveLayout(selectedSourceId, d.ai_pages, autoSaveViewId ?? null);
          }
          if (d.ai_page_statuses) setAiPageStatuses(d.ai_page_statuses);
          if (d.ai_warnings) setAiWarnings(d.ai_warnings);
          setGenerating(false);
        }
        if (eventType === "error" || eventType === "plan_failed") {
          setCanvasError((event.error as string) ?? "AI generation failed.");
          setAiStatus({ state: "plan_failed", last_error: (event.error as string) ?? null });
          setGenerating(false);
        }
      }
    }
    setGenerating(false);
  }

  async function sendSteerMessage(overrideMessage?: string) {
    const message = (overrideMessage ?? steerInput).trim();
    if (!message || !sourceId || steering) return;
    if (!overrideMessage) setSteerInput("");
    setSteerMessages((prev) => [...prev, { role: "user", content: message }]);
    setSteering(true);
    setProgressLog([]);

    try {
      const res = await fetch(`/api/sources/${sourceId}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, currentPages: aiPages }),
      });
      if (!res.ok || !res.body) {
        setSteerMessages((prev) => [...prev, { role: "assistant", content: "Failed to connect to steer API." }]);
        setSteering(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let tomNoted = false;
      let nonSpecAnswered = false;
      let specChanged = false;
      let latestPages: AiPage[] = aiPages;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let event: Record<string, unknown>;
          try { event = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }

          const eventType = event.type as string;
          setProgressLog((prev) => [...prev, event as ProgressStep]);

          if (eventType === "navigate") {
            nonSpecAnswered = true;
            const target = event.target as "page" | "source";
            const id = event.id as string;
            if (target === "page") {
              setActiveAiPageId(id);
              const page = aiPages.find((p) => p.id === id);
              setSteerMessages((prev) => [...prev, { role: "assistant", content: `Switched to "${page?.title ?? id}".` }]);
            } else if (target === "source") {
              setSourceId(id);
              void fetchCanvas(id);
              const src = sources.find((s) => s.id === id);
              setSteerMessages((prev) => [...prev, { role: "assistant", content: `Switched to source "${src?.name ?? id}".` }]);
            }
          }
          if (eventType === "query_answer") {
            nonSpecAnswered = true;
            setSteerMessages((prev) => [...prev, { role: "assistant", content: event.answer as string }]);
          }
          if (eventType === "plan_ready") {
            const pages = (event.pages as Array<{ id: string; title: string; description: string }>) ?? [];
            setAiPages(pages.map((p) => ({ id: p.id, title: p.title, description: p.description, components: [] })));
          }
          if (eventType === "page_done") {
            const page_id = event.page_id as string;
            const components = (event.components as AiPage["components"]) ?? [];
            setAiPages((prev) => prev.map((p) => p.id === page_id ? { ...p, components } : p));
            setAiPageStatuses((prev) => {
              const existing = prev.find((s) => s.page_id === page_id);
              if (existing) return prev.map((s) => s.page_id === page_id ? { ...s, state: "ready" as const, attempts_used: (event.attempts_used as number) ?? 1 } : s);
              return [...prev, { page_id, state: "ready", attempts_used: (event.attempts_used as number) ?? 1, last_error: null, warnings: [] }];
            });
          }
          if (eventType === "page_failed") {
            const page_id = event.page_id as string;
            setAiPageStatuses((prev) => {
              const existing = prev.find((s) => s.page_id === page_id);
              if (existing) return prev.map((s) => s.page_id === page_id ? { ...s, state: "invalid" as const, last_error: (event.last_error as string) ?? null } : s);
              return [...prev, { page_id, state: "invalid", attempts_used: (event.attempts_used as number) ?? 20, last_error: (event.last_error as string) ?? null, warnings: [] }];
            });
          }
          if (eventType === "done") {
            const d = event as { tom_noted?: boolean; instruction?: string; ai_pages?: AiPage[]; ai_page_statuses?: AiPageStatus[]; ai_warnings?: string[]; ai_status?: AiStatus };
            if (d.tom_noted) {
              tomNoted = true;
              setSteerMessages((prev) => [...prev, { role: "assistant", content: `Got it — I'll remember: "${d.instruction ?? message}"` }]);
            }
            if (d.ai_pages && d.ai_pages.length > 0) {
              latestPages = d.ai_pages;
              setAiPages(d.ai_pages);
              setActiveAiPageId((cur) => cur && d.ai_pages?.some((p) => p.id === cur) ? cur : d.ai_pages?.[0]?.id ?? "");
              setIsSaved(false);
              specChanged = true;
            }
            if (d.ai_page_statuses) setAiPageStatuses(d.ai_page_statuses);
            if (d.ai_warnings) setAiWarnings(d.ai_warnings);
            if (d.ai_status) setAiStatus(d.ai_status);
            if (!tomNoted && !nonSpecAnswered) {
              setSteerMessages((prev) => [...prev, { role: "assistant", content: "Done — view updated." }]);
            }
          }
          if (eventType === "error") {
            setSteerMessages((prev) => [...prev, { role: "assistant", content: (event.error as string) ?? "Something went wrong." }]);
          }
        }
      }
      // After a spec change, refresh any dynamic components listening to dock_context_change.
      if (specChanged) {
        void runContentRefresh(sourceId, latestPages, "dock_context_change");
      }
    } catch {
      setSteerMessages((prev) => [...prev, { role: "assistant", content: "Request failed." }]);
    }

    setSteering(false);
    setTimeout(() => {
      steerScrollRef.current?.scrollTo({ top: steerScrollRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }

  async function applyDraft(activeViewId: string, draft: Draft) {
    setBusy("Applying new layout draft...");
    await fetch(`/api/views/${activeViewId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "Apply latest auto-generated draft.", draftId: draft.id }),
    });
    await fetchCanvas(sourceId);
    setBusy("");
  }

  async function markFollowedUp(invoiceId: string, activeViewId: string) {
    setBusy(`Updating ${invoiceId}...`);
    await fetch(`/api/views/${activeViewId}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "mark_followed_up", payload: { sourceId, invoiceId } }),
    });
    await fetchCanvas(sourceId);
    setBusy("");
  }

  function selectAiPage(pageId: string) {
    if (sourceId) writeTab(sourceId, pageId);
    setActiveAiPageId(pageId);
  }

  function addOfflineMessage() {
    setSteerMessages((prev) => [
      ...prev,
      { role: "assistant" as const, content: "I\u2019m offline right now \u2014 this action will work once the agent is connected." },
    ]);
  }

  return {
    views, setViews, activeViewId, setActiveViewId,
    rows, pendingDraft, setPendingDraft,
    generating, canvasError,
    aiStatus, aiPages, aiPageStatuses, activeAiPageId, setActiveAiPageId: selectAiPage,
    aiWarnings, progressLog,
    isSaved, isSavingLayout, isRefreshingContent, refreshingComponentIds, saveError,
    steerMessages, steerInput, setSteerInput,
    steering, steerHintIdx, steerScrollRef,
    loadOrGenerate, fetchCanvas, saveLayout, regenerate,
    sendSteerMessage, applyDraft, markFollowedUp, addOfflineMessage,
    refreshDynamic,
  };
}
