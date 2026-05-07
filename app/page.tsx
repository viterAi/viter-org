"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

import type {
  Source, SourceChannel, SourceSeedFormat,
  View, Row, Draft, UiColumn,
  AiPage, AiPageStatus, AiStatus, ProgressStep,
} from "./types";
import { eur } from "./utils";
import { LeftSidebar } from "./components/LeftSidebar";
import { TabBar } from "./components/TabBar";
import { Dock } from "./components/Dock";
import { AiComponentRenderer } from "./components/AiComponentRenderer";
import { AnimatedTile } from "./components/AnimatedTile";
import { GenerationProgress } from "./components/GenerationProgress";
import { STEER_HINTS } from "./utils";

const lanes = ["todo", "in_progress", "followed_up"] as const;

export default function HomePage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState<string>("");
  const [views, setViews] = useState<View[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [canvasError, setCanvasError] = useState<string>("");
  const [busy, setBusy] = useState<string>("");
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: "ready", last_error: null });
  const [aiPages, setAiPages] = useState<AiPage[]>([]);
  const [aiPageStatuses, setAiPageStatuses] = useState<AiPageStatus[]>([]);
  const [activeAiPageId, setActiveAiPageId] = useState<string>("");
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [progressLog, setProgressLog] = useState<ProgressStep[]>([]);
  const [createSourceOpen, setCreateSourceOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());
  const [steerMessages, setSteerMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [steerInput, setSteerInput] = useState("");
  const [steering, setSteering] = useState(false);
  const [steerHintIdx, setSteerHintIdx] = useState(0);
  const steerScrollRef = React.useRef<HTMLDivElement | null>(null);

  const [leftWidth, setLeftWidth] = useState<number>(168);
  const [rightWidth, setRightWidth] = useState<number>(300);
  const draggingLeft = useRef(false);
  const draggingRight = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceKey, setNewSourceKey] = useState("");
  const [newSourceChannel, setNewSourceChannel] = useState<SourceChannel>("manual_upload");
  const [newSourceFormat, setNewSourceFormat] = useState<SourceSeedFormat>("markdown");
  const [newSourceData, setNewSourceData] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("viter-left-width");
    if (stored) setLeftWidth(Number(stored));
  }, []);
  useEffect(() => {
    const stored = localStorage.getItem("viter-right-width");
    if (stored) setRightWidth(Number(stored));
  }, []);
  useEffect(() => { localStorage.setItem("viter-left-width", String(leftWidth)); }, [leftWidth]);
  useEffect(() => { localStorage.setItem("viter-right-width", String(rightWidth)); }, [rightWidth]);

  const startDragLeft = useCallback((e: React.MouseEvent) => {
    draggingLeft.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = leftWidth;
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      if (!draggingLeft.current) return;
      setLeftWidth(Math.max(120, Math.min(400, dragStartWidth.current + ev.clientX - dragStartX.current)));
    };
    const onUp = () => { draggingLeft.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [leftWidth]);

  const startDragRight = useCallback((e: React.MouseEvent) => {
    draggingRight.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = rightWidth;
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      if (!draggingRight.current) return;
      setRightWidth(Math.max(200, Math.min(600, dragStartWidth.current + dragStartX.current - ev.clientX)));
    };
    const onUp = () => { draggingRight.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rightWidth]);

  useEffect(() => {
    if (!steering) return;
    setSteerHintIdx(0);
    const id = setInterval(() => setSteerHintIdx((n) => (n + 1) % STEER_HINTS.length), 3000);
    return () => clearInterval(id);
  }, [steering]);

  const activeView = useMemo(() => views.find((v) => v.id === activeViewId) ?? null, [views, activeViewId]);

  async function fetchSources() {
    const res = await fetch("/api/sources");
    const json = await res.json();
    const list: Source[] = json.sources ?? [];
    setSources(list);
    if (list.length > 0 && !sourceId) {
      const first = list[0];
      setSourceId(first.id);
      setExpandedChannels(new Set([first.channel ?? "manual_upload"]));
    }
  }

  async function fetchCanvas(selectedSourceId: string, retry = false) {
    if (!selectedSourceId) return;
    setGenerating(true);
    setCanvasError("");
    setProgressLog([]);
    setAiPages([]);
    setAiPageStatuses([]);
    setAiWarnings([]);
    setRows([]);
    void retry;

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
            setActiveAiPageId((cur) => cur && d.ai_pages?.some((p) => p.id === cur) ? cur : d.ai_pages?.[0]?.id ?? "");
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

  async function markFollowedUp(invoiceId: string) {
    if (!activeView || !sourceId) return;
    setBusy(`Updating ${invoiceId}...`);
    await fetch(`/api/views/${activeView.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "mark_followed_up", payload: { sourceId, invoiceId } }),
    });
    await fetchCanvas(sourceId);
    setBusy("");
  }

  async function applyDraft() {
    if (!activeView || !pendingDraft) return;
    setBusy("Applying new layout draft...");
    await fetch(`/api/views/${activeView.id}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "Apply latest auto-generated draft.", draftId: pendingDraft.id }),
    });
    await fetchCanvas(sourceId);
    setBusy("");
  }

  async function sendSteerMessage() {
    const message = steerInput.trim();
    if (!message || !sourceId || steering) return;
    setSteerInput("");
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
              setAiPages(d.ai_pages);
              setActiveAiPageId((cur) => cur && d.ai_pages?.some((p) => p.id === cur) ? cur : d.ai_pages?.[0]?.id ?? "");
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
    } catch {
      setSteerMessages((prev) => [...prev, { role: "assistant", content: "Request failed." }]);
    }

    setSteering(false);
    setTimeout(() => {
      steerScrollRef.current?.scrollTo({ top: steerScrollRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }

  async function createSource() {
    const name = newSourceName.trim();
    const key = newSourceKey.trim().toLowerCase();
    if (!name || !key) { setBusy("Source name and key are required."); return; }
    setBusy("Creating source...");
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, key, channel: newSourceChannel, seedFormat: newSourceFormat, markdown: newSourceData }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; source?: Source };
    if (!res.ok || !json.source) { setBusy(json.error ?? "Failed to create source."); return; }
    await fetchSources();
    setSourceId(json.source.id);
    setCreateSourceOpen(false);
    setNewSourceName(""); setNewSourceKey(""); setNewSourceChannel("manual_upload");
    setNewSourceFormat("markdown"); setNewSourceData(""); setBusy("");
  }

  useEffect(() => { setMounted(true); fetchSources().finally(() => setLoading(false)); }, []);
  useEffect(() => { if (sourceId) void fetchCanvas(sourceId); }, [sourceId]);
  useEffect(() => { for (const w of aiWarnings) console.warn("[ai-layout]", w); }, [aiWarnings]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const activeColumns: UiColumn[] = (() => {
    const columns = activeView?.spec?.layout?.columns;
    if (Array.isArray(columns) && columns.length > 0) {
      const first = columns[0];
      if (typeof first === "string") return (columns as string[]).map((field) => ({ id: field, field, label: field, kind: "string" as const }));
      return columns as UiColumn[];
    }
    return Object.keys(rows[0] ?? {}).map((field) => ({ id: field, field, label: field, kind: "string" as const }));
  })();

  const rowKey = activeView?.spec?.layout?.row_key ?? (rows[0]?.invoice_id ? "invoice_id" : "id");
  const sourceName = sources.find((s) => s.id === sourceId)?.name ?? "No source selected";
  const showAiOnly = aiStatus.state === "invalid" || aiStatus.state === "plan_failed";
  const activeAiPageStatus = aiPageStatuses.find((s) => s.page_id === activeAiPageId) ?? null;
  const activeAiPage = aiPages.find((page) => page.id === activeAiPageId) ?? aiPages[0] ?? null;

  const statusField = activeColumns.find((c) => c.field === "status")?.field;
  const followUpField = activeColumns.find((c) => c.field === "follow_up_status")?.field;
  const attentionRows = rows.filter((row) => {
    const status = String((statusField && row[statusField]) ?? "");
    const follow = String((followUpField && row[followUpField]) ?? "");
    return status.includes("due_31") || status.includes("due_61") || follow === "todo" || follow === "in_progress";
  }).slice(0, 5);

  const numericColumns = activeColumns.filter((c) => c.kind === "number" && rows.some((r) => typeof r[c.field] === "number"));
  const primaryNumeric = numericColumns[0];
  const primaryTotal = primaryNumeric ? rows.reduce((acc, r) => acc + (typeof r[primaryNumeric.field] === "number" ? (r[primaryNumeric.field] as number) : 0), 0) : null;
  const todoCount = rows.filter((r) => r.follow_up_status === "todo").length;
  const inProgressCount = rows.filter((r) => r.follow_up_status === "in_progress").length;
  const followedUpCount = rows.filter((r) => r.follow_up_status === "followed_up").length;

  const dragPip: React.CSSProperties = { width: 2, height: 32, borderRadius: 1, background: "var(--line-thin)", opacity: 0.6, transition: "height 0.15s, opacity 0.15s, background 0.15s" };

  return (
    <div style={{ height: "100vh", display: "flex", gap: 0, padding: 8 }}>
      <LeftSidebar
        sources={sources} sourceId={sourceId} setSourceId={setSourceId}
        expandedChannels={expandedChannels} setExpandedChannels={setExpandedChannels}
        createSourceOpen={createSourceOpen} setCreateSourceOpen={setCreateSourceOpen}
        newSourceName={newSourceName} setNewSourceName={setNewSourceName}
        newSourceKey={newSourceKey} setNewSourceKey={setNewSourceKey}
        newSourceChannel={newSourceChannel} setNewSourceChannel={setNewSourceChannel}
        newSourceFormat={newSourceFormat} setNewSourceFormat={setNewSourceFormat}
        newSourceData={newSourceData} setNewSourceData={setNewSourceData}
        createSource={createSource} busy={busy} mounted={mounted} width={leftWidth}
      />

      <div onMouseDown={startDragLeft} className="drag-handle" style={{ width: 8, flexShrink: 0, cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
        <div className="drag-pip" style={dragPip} />
      </div>

      <main style={{ flex: 1, minWidth: 0, background: "var(--bg-surface)", borderRadius: "var(--r-zone)", boxShadow: "inset 0 0 0 0.5px var(--line-thin)", display: "flex", flexDirection: "column" }}>
        <TabBar
          aiPages={aiPages} activeAiPageId={activeAiPageId} setActiveAiPageId={setActiveAiPageId}
          aiPageStatuses={aiPageStatuses} views={views} activeViewId={activeViewId}
          setActiveViewId={setActiveViewId} pendingDraft={pendingDraft} activeView={activeView}
          applyDraft={applyDraft} busy={busy} sourceName={sourceName}
        />

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: 20 }}>
          {mounted && loading ? <p>Loading sources...</p> : null}
          {mounted && !loading && !sourceId ? (
            <p style={{ fontSize: 13, color: "var(--ink-tertiary)" }}>Select a source from the left rail to get started.</p>
          ) : null}

          {canvasError ? (
            <div style={{ padding: 12, borderRadius: 6, background: "var(--danger-tint)", color: "var(--ink-secondary)", fontSize: 12 }}>
              {canvasError}
            </div>
          ) : null}

          {showAiOnly ? (
            <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: "20px 16px", border: "0.5px solid var(--line-thin)", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>AI status</div>
              <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>state: <b>{aiStatus.state}</b></div>
              {aiStatus.last_error ? (
                <div style={{ fontSize: 11, color: "var(--ink-secondary)", fontFamily: "monospace", background: "var(--bg-surface)", padding: "6px 8px", borderRadius: 4 }}>{aiStatus.last_error}</div>
              ) : null}
              {aiPageStatuses.length > 0 ? (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--ink-tertiary)" }}>Per-page status</div>
                  {aiPageStatuses.map((ps) => (
                    <div key={ps.page_id} style={{ fontSize: 11, color: ps.state === "invalid" ? "var(--ink-secondary)" : "var(--ink-tertiary)" }}>
                      <b>{ps.page_id}</b>: {ps.state} — {ps.attempts_used} attempts{ps.last_error ? ` — ${ps.last_error}` : ""}
                    </div>
                  ))}
                </div>
              ) : null}
              <button onClick={() => { if (sourceId) void fetchCanvas(sourceId, true); }} className="btn-solid" style={{ all: "unset", cursor: "pointer", marginTop: 4, fontSize: 11, padding: "6px 10px", borderRadius: 4, background: "var(--ink-primary)", color: "white", display: "inline-block" }}>
                Retry AI
              </button>
            </div>
          ) : null}

          {generating ? <GenerationProgress progressLog={progressLog} /> : null}

          {!showAiOnly && !generating && activeAiPageStatus?.state === "invalid" ? (
            <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10, fontSize: 11, color: "var(--ink-secondary)" }}>
              Page <b>{activeAiPageStatus.page_id}</b> failed after {activeAiPageStatus.attempts_used} attempts: {activeAiPageStatus.last_error}
            </div>
          ) : null}

          <AnimatePresence mode="wait">
            {!showAiOnly && !generating && activeAiPage ? (
              <motion.div
                key={activeAiPageId}
                initial={{ opacity: 0, x: 36 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -36 }}
                transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
                style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}
              >
                <AnimatePresence>
                  {activeAiPage.components.map((component, index) => {
                    const rendered = (
                      <AiComponentRenderer
                        component={component}
                        index={index}
                        rows={rows}
                        activeColumns={activeColumns}
                        attentionRows={attentionRows}
                      />
                    );
                    return (
                      <AnimatedTile key={`${component.component_id}-${index}`} delay={index * 0.055}>
                        {rendered}
                      </AnimatedTile>
                    );
                  })}
                </AnimatePresence>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {!showAiOnly && !generating && !activeAiPage && activeView ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 18 }}>
              {activeView.view_type === "follow_up_kanban" ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {[["Todo", todoCount], ["In Progress", inProgressCount], ["Followed Up", followedUpCount], ["View", activeView.view_name]].map(([label, val]) => (
                    <div key={String(label)} style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                      <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase" }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{val}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {[["Rows", rows.length], ["Columns", activeColumns.length], ["Primary Total", primaryTotal === null ? "—" : eur(primaryTotal)], ["View", activeView.view_name]].map(([label, val]) => (
                    <div key={String(label)} style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                      <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase" }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 8 }}>
                  {activeView.view_type === "follow_up_kanban" ? "Follow-up queue" : "Needs attention"}
                </div>
                {attentionRows.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No urgent items detected.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {attentionRows.map((row, idx) => (
                      <div key={`attention-${idx}`} style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                        {String(row.client_name ?? row.invoice_id ?? `Row ${idx + 1}`)} — {String(row.status ?? row.follow_up_status ?? "review")}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {!showAiOnly && !generating && activeView?.view_type === "aging_table" ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {activeColumns.map((column) => (
                    <th key={column.id} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "0.5px solid var(--line-thin)", color: "var(--ink-tertiary)", fontWeight: 500 }}>{column.label}</th>
                  ))}
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "0.5px solid var(--line-thin)", color: "var(--ink-tertiary)", fontWeight: 500 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr className="data-row" key={`${String(row[rowKey] ?? "row")}-${index}`}>
                    {activeColumns.map((column, ci) => {
                      const value = row[column.field];
                      return (
                        <td key={`${column.id}-${ci}`} style={{ padding: "10px", borderBottom: "0.5px solid var(--line-thin)" }}>
                          {column.kind === "number" && typeof value === "number" ? eur(value) : String(value ?? "")}
                        </td>
                      );
                    })}
                    <td style={{ padding: "10px", borderBottom: "0.5px solid var(--line-thin)" }}>
                      <button disabled={row.follow_up_status === "followed_up" || !row.invoice_id || !!busy} onClick={() => markFollowedUp(String(row.invoice_id))} className="btn-outline" style={{ all: "unset", cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 4, boxShadow: "inset 0 0 0 0.5px var(--line-strong)", color: "var(--ink-secondary)" }}>
                        Mark followed up
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {!showAiOnly && !generating && activeView?.view_type === "follow_up_kanban" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {lanes.map((lane) => (
                <div key={lane} style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 8 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-tertiary)", marginBottom: 8 }}>{lane}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {rows.filter((r) => r.follow_up_status === lane).map((row, index) => (
                      <div key={String(row.invoice_id ?? index)} style={{ background: "var(--bg-surface)", borderRadius: 4, padding: "8px 9px", boxShadow: "inset 0 0 0 0.5px var(--line-thin)" }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{String(row.invoice_id ?? "Item")}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-secondary)", marginTop: 2 }}>{String(row.client_name ?? "")}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginTop: 2 }}>{typeof row.amount_cents === "number" ? eur(row.amount_cents) : ""}</div>
                        {lane !== "followed_up" ? (
                          <button onClick={() => markFollowedUp(String(row.invoice_id))} className="btn-ghost" style={{ all: "unset", cursor: "pointer", marginTop: 8, fontSize: 11, color: "var(--accent)", padding: "3px 6px", borderRadius: 4 }}>
                            Mark followed up
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </main>

      <div onMouseDown={startDragRight} className="drag-handle" style={{ width: 8, flexShrink: 0, cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
        <div className="drag-pip" style={dragPip} />
      </div>

      <Dock
        steerMessages={steerMessages}
        steerInput={steerInput} setSteerInput={setSteerInput}
        steering={steering} steerHintIdx={steerHintIdx}
        sendSteerMessage={sendSteerMessage}
        sourceId={sourceId} hasPages={aiPages.length > 0}
        steerScrollRef={steerScrollRef} width={rightWidth}
      />
    </div>
  );
}
