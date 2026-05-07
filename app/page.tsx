"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Source = { id: string; name: string; key: string; channel?: string; markdown?: string };
type SourceChannel = string;
type SourceSeedFormat = "markdown" | "json" | "csv";
type View = {
  id: string;
  source_id: string;
  view_name: string;
  view_type: "aging_table" | "follow_up_kanban";
  is_default: boolean;
  spec?: {
    layout?: {
      row_key?: string;
      columns?:
        | Array<{
            id: string;
            field: string;
            label: string;
            kind: "string" | "number" | "date";
          }>
        | string[];
    };
  };
};
type Row = Record<string, string | number | boolean | null>;
type Draft = {
  id: string;
  view_id: string;
  source_fingerprint: string;
  status: "pending" | "applied" | "discarded";
};
type UiColumn = {
  id: string;
  field: string;
  label: string;
  kind: "string" | "number" | "date";
};
type AiPage = {
  id: string;
  title: string;
  description?: string;
  components: Array<{ component_id: string; props?: Record<string, unknown> }>;
};
type AiPageStatus = {
  page_id: string;
  state: "ready" | "invalid";
  attempts_used: number;
  last_error: string | null;
  warnings: string[];
};
type AiStatus = {
  state: "generating" | "invalid" | "ready" | "plan_failed";
  last_error: string | null;
};
type ProgressStep =
  | { type: "planning" }
  | { type: "plan_ready"; pages: Array<{ id: string; title: string; description: string }> }
  | { type: "page_start"; page_id: string; title: string; max_attempts: number }
  | { type: "page_attempt"; page_id: string; attempt: number; max_attempts: number; last_error: string | null }
  | { type: "page_done"; page_id: string; title: string; attempts_used: number }
  | { type: "page_failed"; page_id: string; last_error: string | null; attempts_used: number }
  | { type: "done" }
  | { type: "error"; error: string };

const lanes = ["todo", "in_progress", "followed_up"] as const;

// ── Source preview: derive row count + excerpt from raw markdown ─────────────
function sourcePreview(s: Source): { rowCount: number | null; excerpt: string } {
  const md = (s.markdown ?? "").trim();
  if (!md) return { rowCount: null, excerpt: "" };
  const lines = md.split("\n");
  // CSV: count non-empty non-header lines that contain commas
  const csvData = lines.filter((l, i) => i > 0 && l.trim() && l.includes(","));
  // Markdown table: count rows (lines with | that are not separator rows)
  const tableRows = lines.filter((l) => l.includes("|") && !/^[\s|:=-]+$/.test(l));
  const rowCount = csvData.length > 0 ? csvData.length : tableRows.length > 1 ? tableRows.length - 1 : null;
  const excerpt = md.slice(0, 60).replace(/\n/g, " ").trim();
  return { rowCount, excerpt };
}

// ── Source icon: DuckDuckGo favicon → letter avatar fallback ────────────────
// DuckDuckGo's favicon service returns a real PNG for known domains and
// a proper 404 for unknown ones — so plain onLoad/onError is all we need.
// URL: https://icons.duckduckgo.com/ip3/{domain}.ico
const CHANNEL_DOMAINS: Record<string, string> = {
  gmail: "gmail.com", outlook: "outlook.com", email: "gmail.com",
  slack: "slack.com", whatsapp: "whatsapp.com", telegram: "telegram.org",
  facebook_messenger: "messenger.com", facebook: "facebook.com",
  instagram: "instagram.com", linkedin: "linkedin.com", twitter_x: "x.com",
  monday_com: "monday.com", notion: "notion.so", airtable: "airtable.com",
  google_sheets: "sheets.google.com", excel: "microsoft.com",
  hubspot: "hubspot.com", salesforce: "salesforce.com",
  zendesk: "zendesk.com", intercom: "intercom.com",
  onedrive: "onedrive.live.com", google_drive: "drive.google.com",
  dropbox: "dropbox.com", sharepoint: "sharepoint.com",
};

function SourceIcon({ name, keyStr, domain: domainOverride }: { name: string; keyStr: string; domain?: string }) {
  const [imgOk, setImgOk] = useState<boolean | null>(null);
  const domain = domainOverride ?? keyStr.replace(/_/g, "").replace(/\s+/g, "").toLowerCase() + ".com";
  const src = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const letter = (name[0] ?? "?").toUpperCase();

  return (
    <span style={{ position: "relative", width: 18, height: 18, flexShrink: 0, display: "inline-flex" }}>
      {/* Letter avatar — visible by default, hidden once a real favicon loads */}
      <span
        style={{
          position: "absolute", inset: 0,
          borderRadius: 4,
          background: `hsl(${hue}, 52%, 62%)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 700, color: "white",
          opacity: imgOk === true ? 0 : 1,
          transition: "opacity 0.2s",
        }}
      >
        {letter}
      </span>
      {/* Favicon — fades in on successful load, stays hidden on 404 */}
      <img
        src={src}
        alt=""
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          borderRadius: 3,
          objectFit: "contain",
          opacity: imgOk === true ? 1 : 0,
          transition: "opacity 0.25s",
        }}
        onLoad={() => setImgOk(true)}
        onError={() => setImgOk(false)}
      />
    </span>
  );
}

// ── Animation helpers ────────────────────────────────────────────────────────
function AnimatedTile({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24, delay }}
    >
      {children}
    </motion.div>
  );
}

function eur(cents: number) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

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
  const [aiStatus, setAiStatus] = useState<AiStatus>({
    state: "ready",
    last_error: null,
  });
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
  const steerScrollRef = React.useRef<HTMLDivElement>(null);

  const [leftWidth, setLeftWidth] = useState<number>(168);
  const [rightWidth, setRightWidth] = useState<number>(300);
  const draggingLeft = useRef(false);
  const draggingRight = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    const stored = localStorage.getItem("viter-left-width");
    if (stored) setLeftWidth(Number(stored));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("viter-right-width");
    if (stored) setRightWidth(Number(stored));
  }, []);

  useEffect(() => {
    localStorage.setItem("viter-left-width", String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    localStorage.setItem("viter-right-width", String(rightWidth));
  }, [rightWidth]);

  const startDragLeft = useCallback((e: React.MouseEvent) => {
    draggingLeft.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = leftWidth;
    e.preventDefault();

    const onMove = (ev: MouseEvent) => {
      if (!draggingLeft.current) return;
      const delta = ev.clientX - dragStartX.current;
      setLeftWidth(Math.max(120, Math.min(400, dragStartWidth.current + delta)));
    };
    const onUp = () => {
      draggingLeft.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
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
      const delta = dragStartX.current - ev.clientX;
      setRightWidth(Math.max(200, Math.min(600, dragStartWidth.current + delta)));
    };
    const onUp = () => {
      draggingRight.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rightWidth]);

  const STEER_HINTS = [
    "Crossing the t's…",
    "Dotting the i's…",
    "Connecting the dots…",
    "Reading between the lines…",
    "Laying out components…",
    "Reviewing the structure…",
    "Untangling the data…",
    "Sharpening the layout…",
    "Checking the details…",
    "Almost there…",
  ];

  useEffect(() => {
    if (!steering) return;
    setSteerHintIdx(0);
    const id = setInterval(() => setSteerHintIdx((n) => (n + 1) % STEER_HINTS.length), 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steering]);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceKey, setNewSourceKey] = useState("");
  const [newSourceChannel, setNewSourceChannel] =
    useState<SourceChannel>("manual_upload");
  const [newSourceFormat, setNewSourceFormat] =
    useState<SourceSeedFormat>("markdown");
  const [newSourceData, setNewSourceData] = useState("");

  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) ?? null,
    [views, activeViewId],
  );

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
        try {
          event = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }

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
            const existing = prev.find((s) => s.page_id === page_id);
            if (existing) return prev;
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
          const donePayload = event as { rows?: Row[]; ai_status?: AiStatus; ai_pages?: AiPage[]; ai_page_statuses?: AiPageStatus[]; ai_warnings?: string[] };
          if (donePayload.rows) setRows(donePayload.rows);
          if (donePayload.ai_status) setAiStatus(donePayload.ai_status);
          if (donePayload.ai_pages) {
            setAiPages(donePayload.ai_pages);
            setActiveAiPageId((cur) => cur && donePayload.ai_pages?.some((p) => p.id === cur) ? cur : donePayload.ai_pages?.[0]?.id ?? "");
          }
          if (donePayload.ai_page_statuses) setAiPageStatuses(donePayload.ai_page_statuses);
          if (donePayload.ai_warnings) setAiWarnings(donePayload.ai_warnings);
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
      body: JSON.stringify({
        action: "mark_followed_up",
        payload: { sourceId, invoiceId },
      }),
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
      body: JSON.stringify({
        summary: "Apply latest auto-generated draft for new source data.",
        draftId: pendingDraft.id,
      }),
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
      let nonSpecAnswered = false; // true if query/navigate handled their own reply

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
          try {
            event = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            continue;
          }

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
            const answer = event.answer as string;
            setSteerMessages((prev) => [...prev, { role: "assistant", content: answer }]);
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
            const donePayload = event as { tom_noted?: boolean; instruction?: string; ai_pages?: AiPage[]; ai_page_statuses?: AiPageStatus[]; ai_warnings?: string[]; ai_status?: AiStatus };
            if (donePayload.tom_noted) {
              tomNoted = true;
              setSteerMessages((prev) => [...prev, { role: "assistant", content: `Got it — I'll remember: "${donePayload.instruction ?? message}"` }]);
            }
            if (donePayload.ai_pages && donePayload.ai_pages.length > 0) {
              setAiPages(donePayload.ai_pages);
              setActiveAiPageId((cur) => cur && donePayload.ai_pages?.some((p) => p.id === cur) ? cur : donePayload.ai_pages?.[0]?.id ?? "");
            }
            if (donePayload.ai_page_statuses) setAiPageStatuses(donePayload.ai_page_statuses);
            if (donePayload.ai_warnings) setAiWarnings(donePayload.ai_warnings);
            if (donePayload.ai_status) setAiStatus(donePayload.ai_status);
            // Only show "Done" for spec changes — query/navigate/tom all add their own reply
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
    if (!name || !key) {
      setBusy("Source name and key are required.");
      return;
    }
    setBusy("Creating source...");
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        key,
        channel: newSourceChannel,
        seedFormat: newSourceFormat,
        markdown: newSourceData,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      source?: Source;
    };
    if (!res.ok || !json.source) {
      setBusy(json.error ?? "Failed to create source.");
      return;
    }
    await fetchSources();
    setSourceId(json.source.id);
    setCreateSourceOpen(false);
    setNewSourceName("");
    setNewSourceKey("");
    setNewSourceChannel("manual_upload");
    setNewSourceFormat("markdown");
    setNewSourceData("");
    setBusy("");
  }

  useEffect(() => {
    setMounted(true);
    fetchSources().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sourceId) void fetchCanvas(sourceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId]);

  useEffect(() => {
    for (const w of aiWarnings) console.warn("[ai-layout]", w);
  }, [aiWarnings]);

  const activeColumns: UiColumn[] = (() => {
    const columns = activeView?.spec?.layout?.columns;
    if (Array.isArray(columns) && columns.length > 0) {
      const first = columns[0];
      if (typeof first === "string") {
        return (columns as string[]).map((field) => ({
          id: field,
          field,
          label: field,
          kind: "string" as const,
        }));
      }
      return columns as UiColumn[];
    }
    return Object.keys(rows[0] ?? {}).map((field) => ({
      id: field,
      field,
      label: field,
      kind: "string" as const,
    }));
  })();

  const rowKey =
    activeView?.spec?.layout?.row_key ??
    (rows[0]?.invoice_id ? "invoice_id" : "id");

  const sourceName =
    sources.find((s) => s.id === sourceId)?.name ?? "No source selected";
  const showAiOnly = aiStatus.state === "invalid" || aiStatus.state === "plan_failed";
  const activeAiPageStatus = aiPageStatuses.find((s) => s.page_id === activeAiPageId) ?? null;
  const activeAiPage = aiPages.find((page) => page.id === activeAiPageId) ?? aiPages[0] ?? null;

  function renderAiComponent(component: { component_id: string; props?: Record<string, unknown> }, index: number) {
    const cid = component.component_id;
    const props = component.props ?? {};
    const k = `${cid}-${index}`;
    const card: React.CSSProperties = { background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 12 };

    // ── text_block ──────────────────────────────────────────────────────────
    if (cid === "text_block") {
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{String(props.title ?? "Text")}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-secondary)", lineHeight: 1.6 }}>{String(props.body ?? "")}</div>
        </div>
      );
    }

    // ── kpi_row ──────────────────────────────────────────────────────────────
    if (cid === "kpi_row") {
      const metrics = Array.isArray(props.metrics) ? props.metrics : [];
      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(metrics.length || 4, 4)}, 1fr)`, gap: 8 }}>
          {metrics.slice(0, 4).map((m, mi) => {
            const item = (m ?? {}) as Record<string, unknown>;
            return (
              <div key={`kpi-${mi}`} style={card}>
                <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{String(item.label ?? "Metric")}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{item.value != null && item.value !== "" ? String(item.value) : "—"}</div>
              </div>
            );
          })}
        </div>
      );
    }

    // ── metric_card ───────────────────────────────────────────────────────────
    if (cid === "metric_card") {
      return (
        <div key={k} style={{ ...card, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{String(props.label ?? "Metric")}</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{props.value != null && props.value !== "" ? String(props.value) : "—"}</div>
          {props.hint ? <div style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>{String(props.hint)}</div> : null}
        </div>
      );
    }

    // ── attention_list / activity_feed ────────────────────────────────────────
    if (cid === "attention_list" || cid === "activity_feed") {
      const title = String(props.title ?? (cid === "attention_list" ? "Needs attention" : "Activity"));
      const items: unknown[] = Array.isArray(props.items) && (props.items as unknown[]).length > 0
        ? props.items
        : attentionRows.map((r) => `${String(r.client_name ?? r.invoice_id ?? "")} — ${String(r.status ?? r.follow_up_status ?? "")}`);
      if (items.length === 0) return null;
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 8 }}>{title}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {items.slice(0, Number(props.max_items ?? 6)).map((item, ii) => {
              const label = typeof item === "object" && item !== null
                ? String((item as Record<string, unknown>).title ?? (item as Record<string, unknown>).name ?? (item as Record<string, unknown>).label ?? (item as Record<string, unknown>).message ?? (item as Record<string, unknown>).text ?? (item as Record<string, unknown>).description ?? JSON.stringify(item))
                : String(item);
              return (
                <div key={`ai-${ii}`} style={{ fontSize: 12, color: "var(--ink-secondary)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: "var(--ink-tertiary)", flexShrink: 0, marginTop: 2 }}>•</span>
                  {label}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ── filter_bar ────────────────────────────────────────────────────────────
    if (cid === "filter_bar") {
      const fields: unknown[] = Array.isArray(props.fields) ? props.fields : [];
      return (
        <div key={k} style={{ ...card, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>{String(props.title ?? "Filters")}</span>
          {fields.map((f, fi) => {
            const label = typeof f === "object" && f !== null ? String((f as Record<string, unknown>).label ?? (f as Record<string, unknown>).name ?? JSON.stringify(f)) : String(f);
            return <span key={fi} style={{ fontSize: 11, background: "var(--bg-surface)", border: "0.5px solid var(--line-thin)", borderRadius: 12, padding: "3px 10px", color: "var(--ink-secondary)" }}>{label}</span>;
          })}
          {fields.length === 0 && <span style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>No filters defined.</span>}
        </div>
      );
    }

    // ── chart_bar ─────────────────────────────────────────────────────────────
    if (cid === "chart_bar") {
      if (rows.length === 0) return null;
      const groupBy = String(props.group_by ?? "");
      const valueField = String(props.value_field ?? "");
      const agg: Record<string, number> = {};
      for (const row of rows) {
        const gk = String(row[groupBy] ?? "other");
        const v = typeof row[valueField] === "number" ? (row[valueField] as number) : 1;
        agg[gk] = (agg[gk] ?? 0) + v;
      }
      const entries = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8);
      if (entries.length === 0) return null;
      const maxV = Math.max(...entries.map(([, v]) => v), 1);
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 10 }}>{String(props.title ?? (groupBy || "Bar chart"))}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {entries.map(([label, val]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 90, fontSize: 11, color: "var(--ink-secondary)", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
                <div style={{ flex: 1, background: "var(--bg-surface)", borderRadius: 3, height: 14, overflow: "hidden" }}>
                  <div style={{ width: `${(val / maxV) * 100}%`, background: "var(--accent)", height: "100%", borderRadius: 3 }} />
                </div>
                <div style={{ width: 48, fontSize: 11, color: "var(--ink-tertiary)", textAlign: "right", flexShrink: 0 }}>
                  {valueField.includes("cents") ? eur(val) : val.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ── chart_line ────────────────────────────────────────────────────────────
    if (cid === "chart_line") {
      if (rows.length === 0) return null;
      const xField = String(props.x_field ?? "");
      const yField = String(props.y_field ?? "");
      const agg: Record<string, number> = {};
      for (const row of rows) {
        const xk = String(row[xField] ?? "");
        const v = typeof row[yField] === "number" ? (row[yField] as number) : 1;
        if (xk) agg[xk] = (agg[xk] ?? 0) + v;
      }
      const entries = Object.entries(agg).sort(([a], [b]) => a.localeCompare(b)).slice(0, 14);
      const maxV = Math.max(...entries.map(([, v]) => v), 1);
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 10 }}>{String(props.title ?? `${yField} over time`)}</div>
          {entries.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No data available</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 56 }}>
                {entries.map(([label, val]) => (
                  <div key={label} title={`${label}: ${val}`} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                    <div style={{ width: "100%", background: "var(--accent)", borderRadius: "2px 2px 0 0", height: `${Math.max(Math.round((val / maxV) * 100), 4)}%`, opacity: 0.85 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--ink-tertiary)" }}>
                <span>{entries[0]?.[0]}</span>
                <span>{entries[entries.length - 1]?.[0]}</span>
              </div>
            </>
          )}
        </div>
      );
    }

    // ── chart_donut ───────────────────────────────────────────────────────────
    if (cid === "chart_donut") {
      if (rows.length === 0) return null;
      const groupBy = String(props.group_by ?? "");
      const valueField = String(props.value_field ?? "");
      const agg: Record<string, number> = {};
      for (const row of rows) {
        const gk = String(row[groupBy] ?? "other");
        const v = typeof row[valueField] === "number" ? (row[valueField] as number) : 1;
        agg[gk] = (agg[gk] ?? 0) + v;
      }
      const entries = Object.entries(agg);
      const total = entries.reduce((s, [, v]) => s + v, 0);
      const PALETTE = ["var(--accent)", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 10 }}>{String(props.title ?? (groupBy || "Composition"))}</div>
          {entries.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No data available</div>
          ) : (
            <>
              <div style={{ height: 16, display: "flex", borderRadius: 6, overflow: "hidden", gap: 1 }}>
                {entries.map(([label, val], pi) => (
                  <div key={label} title={`${label}: ${val}`} style={{ flex: val, background: PALETTE[pi % PALETTE.length] }} />
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", marginTop: 8 }}>
                {entries.map(([label, val], pi) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ink-secondary)" }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: PALETTE[pi % PALETTE.length], flexShrink: 0 }} />
                    {label} <span style={{ color: "var(--ink-tertiary)" }}>({total > 0 ? Math.round((val / total) * 100) : 0}%)</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      );
    }

    // ── kanban_board ──────────────────────────────────────────────────────────
    if (cid === "kanban_board") {
      if (rows.length === 0) return null;
      const groupBy = String(props.group_by ?? "follow_up_status");
      const titleField = String(props.title_field ?? "invoice_id");
      const subtitleField = String(props.subtitle_field ?? "client_name");
      const valueField = String(props.value_field ?? "amount_cents");
      const lanesProp = Array.isArray(props.lanes) ? props.lanes.map(String) : null;
      const uniqueGroups = [...new Set(rows.map((r) => String(r[groupBy] ?? "other")))];
      const laneKeys = lanesProp ?? uniqueGroups.slice(0, 4);
      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: `repeat(${laneKeys.length}, 1fr)`, gap: 8 }}>
          {laneKeys.map((lane) => {
            const laneRows = rows.filter((r) => String(r[groupBy] ?? "other") === lane);
            return (
              <div key={lane} style={{ ...card, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-tertiary)", marginBottom: 2 }}>
                  {lane} <span style={{ color: "var(--ink-quaternary, var(--ink-tertiary))" }}>({laneRows.length})</span>
                </div>
                {laneRows.slice(0, 8).map((r, ri) => (
                  <div key={ri} style={{ background: "var(--bg-surface)", borderRadius: 4, padding: "7px 9px", boxShadow: "inset 0 0 0 0.5px var(--line-thin)" }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{String(r[titleField] ?? "Item")}</div>
                    {subtitleField && r[subtitleField] ? <div style={{ fontSize: 11, color: "var(--ink-secondary)", marginTop: 1 }}>{String(r[subtitleField])}</div> : null}
                    {valueField && r[valueField] != null ? (
                      <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginTop: 2 }}>
                        {valueField.includes("cents") && typeof r[valueField] === "number" ? eur(r[valueField] as number) : String(r[valueField])}
                      </div>
                    ) : null}
                  </div>
                ))}
                {laneRows.length === 0 && <div style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>Empty</div>}
              </div>
            );
          })}
        </div>
      );
    }

    // ── entity_cards ──────────────────────────────────────────────────────────
    if (cid === "entity_cards") {
      if (rows.length === 0) return null;
      const titleField = String(props.title_field ?? "client_name");
      const subtitleField = String(props.subtitle_field ?? "invoice_id");
      const valueField = String(props.value_field ?? "amount_cents");
      const maxItems = Number(props.max_items ?? 6);
      const cards = rows.slice(0, maxItems);
      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {cards.map((r, ri) => (
            <div key={ri} style={{ ...card, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{String(r[titleField] ?? "—")}</div>
              {subtitleField && r[subtitleField] != null ? <div style={{ fontSize: 11, color: "var(--ink-secondary)" }}>{String(r[subtitleField])}</div> : null}
              {valueField && r[valueField] != null ? (
                <div style={{ fontSize: 12, color: "var(--ink-tertiary)", marginTop: 2 }}>
                  {valueField.includes("cents") && typeof r[valueField] === "number" ? eur(r[valueField] as number) : String(r[valueField])}
                </div>
              ) : null}
            </div>
          ))}
          {cards.length === 0 && <div style={{ gridColumn: "1/-1", fontSize: 12, color: "var(--ink-tertiary)" }}>No entities to display.</div>}
        </div>
      );
    }

    // ── action_panel ──────────────────────────────────────────────────────────
    if (cid === "action_panel") {
      const actions: unknown[] = Array.isArray(props.actions) ? props.actions : [];
      return (
        <div key={k} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>{String(props.title ?? "Actions")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {actions.map((a, ai) => {
              const label = typeof a === "object" && a !== null ? String((a as Record<string, unknown>).label ?? (a as Record<string, unknown>).name ?? JSON.stringify(a)) : String(a);
              return (
                <button key={ai} style={{ all: "unset", cursor: "pointer", fontSize: 12, padding: "6px 12px", borderRadius: 4, boxShadow: "inset 0 0 0 0.5px var(--line-strong)", color: "var(--ink-secondary)" }}>
                  {label}
                </button>
              );
            })}
            {actions.length === 0 && <span style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No actions defined.</span>}
          </div>
        </div>
      );
    }

    // ── empty_state ────────────────────────────────────────────────────────────
    if (cid === "empty_state") {
      return (
        <div key={k} style={{ ...card, textAlign: "center", padding: "32px 16px" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{String(props.title ?? "Nothing here")}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-secondary)" }}>{String(props.message ?? "")}</div>
        </div>
      );
    }

    // ── data_table ─────────────────────────────────────────────────────────────
    if (cid === "data_table") {
      if (rows.length === 0) return null;
      const prefix = `dt${index}`;
      return (
        <div key={k} style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {activeColumns.map((column) => (
                  <th key={`${prefix}-hd-${column.id}`} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "0.5px solid var(--line-thin)", color: "var(--ink-tertiary)", fontWeight: 500 }}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${prefix}-tr-${rowIndex}`}>
                  {activeColumns.map((column) => {
                    const value = row[column.field];
                    return (
                      <td key={`${prefix}-td-${column.id}-${rowIndex}`} style={{ padding: "10px", borderBottom: "0.5px solid var(--line-thin)" }}>
                        {column.kind === "number" && typeof value === "number" ? eur(value) : String(value ?? "")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    // ── fallback (unknown component) ───────────────────────────────────────────
    return (
      <div key={k} style={{ ...card, fontSize: 12, color: "var(--ink-tertiary)", fontStyle: "italic" }}>
        [{cid}]
      </div>
    );
  }

  const numericColumns = activeColumns.filter(
    (column) =>
      column.kind === "number" && rows.some((row) => typeof row[column.field] === "number"),
  );
  const primaryNumeric = numericColumns[0];
  const primaryTotal = primaryNumeric
    ? rows.reduce((acc, row) => {
        const value = row[primaryNumeric.field];
        return acc + (typeof value === "number" ? value : 0);
      }, 0)
    : null;
  const statusField = activeColumns.find((column) => column.field === "status")?.field;
  const followUpField = activeColumns.find((column) => column.field === "follow_up_status")?.field;
  const attentionRows = rows
    .filter((row) => {
      const status = String((statusField && row[statusField]) ?? "");
      const follow = String((followUpField && row[followUpField]) ?? "");
      return (
        status.includes("due_31") ||
        status.includes("due_61") ||
        follow === "todo" ||
        follow === "in_progress"
      );
    })
    .slice(0, 5);
  const todoCount = rows.filter((row) => row.follow_up_status === "todo").length;
  const inProgressCount = rows.filter(
    (row) => row.follow_up_status === "in_progress",
  ).length;
  const followedUpCount = rows.filter(
    (row) => row.follow_up_status === "followed_up",
  ).length;

  // ── Channel grouping ────────────────────────────────────────────────────
  const channelGroups = useMemo(() => {
    const map = new Map<string, Source[]>();
    for (const s of sources) {
      const ch = s.channel ?? "manual_upload";
      if (!map.has(ch)) map.set(ch, []);
      map.get(ch)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [sources]);

  function channelLabel(channel: string): string {
    const labels: Record<string, string> = {
      gmail: "Gmail", outlook: "Outlook", email: "Email",
      slack: "Slack", whatsapp: "WhatsApp", telegram: "Telegram",
      facebook_messenger: "Messenger", facebook: "Facebook",
      instagram: "Instagram", linkedin: "LinkedIn", twitter_x: "X / Twitter",
      monday_com: "Monday.com", notion: "Notion", airtable: "Airtable",
      google_sheets: "Google Sheets", excel: "Excel",
      hubspot: "HubSpot", salesforce: "Salesforce", zendesk: "Zendesk", intercom: "Intercom",
      onedrive: "OneDrive", google_drive: "Google Drive", dropbox: "Dropbox", sharepoint: "SharePoint",
      portal: "Portal / API", database: "Database", webhook: "Webhook",
      manual_upload: "Manual Upload",
    };
    return labels[channel] ?? channel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function channelDescription(channel: string): string {
    const descs: Record<string, string> = {
      gmail: "Email inbox", outlook: "Email", email: "Email",
      slack: "Team messaging", whatsapp: "Messaging", telegram: "Messaging", facebook_messenger: "Messaging",
      facebook: "Social & ads", instagram: "Social", linkedin: "Social", twitter_x: "Social",
      monday_com: "Project management", notion: "Docs & wikis", airtable: "Database", google_sheets: "Spreadsheets", excel: "Spreadsheets",
      hubspot: "CRM", salesforce: "CRM", zendesk: "Support", intercom: "Support",
      onedrive: "File storage", google_drive: "File storage", dropbox: "File storage", sharepoint: "Intranet",
      portal: "Web portal", database: "Database", webhook: "Live feed",
      manual_upload: "Manual data",
    };
    return descs[channel] ?? "Data source";
  }

  function sourcePreview(s: Source): { rowCount: number | null; excerpt: string } {
    const md = (s.markdown ?? "").trim();
    if (!md) return { rowCount: null, excerpt: "No data yet" };
    const lines = md.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length > 1 && lines[0].includes(",")) {
      return { rowCount: lines.length - 1, excerpt: `${lines.length - 1} rows` };
    }
    try {
      const parsed = JSON.parse(md);
      if (Array.isArray(parsed)) return { rowCount: parsed.length, excerpt: `${parsed.length} records` };
    } catch { /* not JSON */ }
    const firstLine = lines.find((l) => l.replace(/^#+\s*/, "").trim().length > 10) ?? lines[0];
    const excerpt = firstLine.replace(/^#+\s*/, "").slice(0, 55).trim();
    return { rowCount: null, excerpt: excerpt + (firstLine.length > 55 ? "…" : "") };
  }

  function toggleChannel(channel: string) {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  }

  return (
    <div style={{ height: "100vh", display: "flex", gap: 0, padding: 8 }}>
      <aside
        style={{
          width: leftWidth,
          flexShrink: 0,
          background: "var(--bg-surface)",
          borderRadius: "var(--r-zone)",
          boxShadow: "inset 0 0 0 0.5px var(--line-thin)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "14px 12px", borderBottom: "0.5px solid var(--line-thin)", fontSize: 14, fontWeight: 600 }}>
          viter
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
          {channelGroups.map(([channel, channelSources]) => {
            const isExpanded = expandedChannels.has(channel);
            const hasActive = channelSources.some((s) => s.id === sourceId);
            return (
              <div key={channel}>
                {/* Channel header */}
                <button
                  onClick={() => toggleChannel(channel)}
                  className="btn-ghost"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    padding: "5px 10px",
                    boxSizing: "border-box",
                    borderRadius: 4,
                  }}
                >
                  <span style={{ fontSize: 10, color: "var(--ink-tertiary)", transition: "transform 0.15s", display: "inline-block", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                  <SourceIcon
                    name={channelLabel(channel)}
                    keyStr={channel}
                    domain={CHANNEL_DOMAINS[channel]}
                  />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: hasActive ? "var(--accent)" : "var(--ink-primary)" }}>
                    {channelLabel(channel)}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--ink-tertiary)", background: "var(--bg-secondary)", borderRadius: 8, padding: "1px 6px" }}>
                    {channelSources.length}
                  </span>
                </button>

                {isExpanded && (
                  <div style={{ marginBottom: 6 }}>
                    {channelSources.map((s) => {
                      const active = s.id === sourceId;
                      const { rowCount, excerpt } = sourcePreview(s);
                      return (
                        <button
                          key={s.id}
                          onClick={() => setSourceId(s.id)}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "block",
                            width: "100%",
                            boxSizing: "border-box",
                            padding: "5px 8px 5px 16px",
                            borderRadius: 4,
                            background: active ? "var(--accent-tint)" : "transparent",
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: active ? 500 : 400, color: active ? "var(--accent)" : "var(--ink-primary)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.name}
                          </div>
                          <div style={{ fontSize: 11, color: active ? "var(--accent)" : "var(--ink-tertiary)", marginTop: 1, opacity: 0.8 }}>
                            {rowCount !== null ? `${rowCount} rows` : excerpt}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: "auto",
            padding: 10,
            borderTop: "0.5px solid var(--line-thin)",
          }}
        >
          <button
            onClick={() => setCreateSourceOpen((open) => !open)}
            suppressHydrationWarning
            className="btn-outline"
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 11,
              padding: "6px 8px",
              borderRadius: 4,
              boxShadow: "inset 0 0 0 0.5px var(--line-strong)",
              color: "var(--ink-secondary)",
              display: "inline-block",
            }}
          >
            {mounted ? (createSourceOpen ? "Close source form" : "Create source") : "Create source"}
          </button>
          {mounted && createSourceOpen ? (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                value={newSourceName}
                onChange={(event) => setNewSourceName(event.target.value)}
                placeholder="Source name"
                style={{
                  border: "0.5px solid var(--line-thin)",
                  borderRadius: 4,
                  background: "var(--bg-surface)",
                  color: "var(--ink-primary)",
                  padding: "6px 8px",
                  fontSize: 11,
                }}
              />
              <input
                value={newSourceKey}
                onChange={(event) => setNewSourceKey(event.target.value)}
                placeholder="source_key"
                style={{
                  border: "0.5px solid var(--line-thin)",
                  borderRadius: 4,
                  background: "var(--bg-surface)",
                  color: "var(--ink-primary)",
                  padding: "6px 8px",
                  fontSize: 11,
                }}
              />
              <input
                value={newSourceChannel}
                onChange={(event) => setNewSourceChannel(event.target.value)}
                placeholder="channel (e.g. gmail, slack, monday_com…)"
                style={{
                  border: "0.5px solid var(--line-thin)",
                  borderRadius: 4,
                  background: "var(--bg-surface)",
                  color: "var(--ink-primary)",
                  padding: "6px 8px",
                  fontSize: 11,
                }}
              />
              <select
                value={newSourceFormat}
                onChange={(event) =>
                  setNewSourceFormat(event.target.value as SourceSeedFormat)
                }
                style={{
                  border: "0.5px solid var(--line-thin)",
                  borderRadius: 4,
                  background: "var(--bg-surface)",
                  color: "var(--ink-primary)",
                  padding: "6px 8px",
                  fontSize: 11,
                }}
              >
                <option value="markdown">markdown</option>
                <option value="json">json</option>
                <option value="csv">csv</option>
              </select>
              <textarea
                value={newSourceData}
                onChange={(event) => setNewSourceData(event.target.value)}
                placeholder="Paste source payload (markdown/json/csv)"
                rows={5}
                style={{
                  border: "0.5px solid var(--line-thin)",
                  borderRadius: 4,
                  background: "var(--bg-surface)",
                  color: "var(--ink-primary)",
                  padding: "6px 8px",
                  fontSize: 11,
                  resize: "vertical",
                }}
              />
              <button
                onClick={createSource}
                className="btn-solid"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "6px 8px",
                  borderRadius: 4,
                  background: "var(--ink-primary)",
                  color: "white",
                  textAlign: "center",
                }}
              >
                Save source
              </button>
            </div>
          ) : null}
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--ink-tertiary)" }}>
            Live data only
          </div>
        </div>
      </aside>

      {/* Left resize handle */}
      <div
        onMouseDown={startDragLeft}
        className="drag-handle"
        style={{
          width: 8,
          flexShrink: 0,
          cursor: "col-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
        }}
      >
        <div className="drag-pip" style={{ width: 2, height: 32, borderRadius: 1, background: "var(--line-thin)", opacity: 0.6, transition: "height 0.15s, opacity 0.15s, background 0.15s" }} />
      </div>

      <main
        style={{
          flex: 1,
          minWidth: 0,
          background: "var(--bg-surface)",
          borderRadius: "var(--r-zone)",
          boxShadow: "inset 0 0 0 0.5px var(--line-thin)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ borderBottom: "0.5px solid var(--line-thin)" }}>
          {/* Source header */}
          <div style={{ padding: "18px 24px 14px", display: "flex", alignItems: "baseline", gap: 10 }}>
            <div style={{ fontSize: 19, fontWeight: 500 }}>{sourceName}</div>
            {aiPages.length > 0 && (
              <div style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--accent)",
                background: "var(--accent-tint)",
                borderRadius: 20,
                padding: "2px 8px",
                letterSpacing: "0.02em",
              }}>
                {aiPages.length} {aiPages.length === 1 ? "page" : "pages"}
              </div>
            )}
          </div>
          {/* Tab bar */}
          {(aiPages.length > 0 || views.length > 0) && (
            <div style={{ display: "flex", overflowX: "auto", paddingLeft: 16, gap: 0 }}>
              {aiPages.map((page, i) => {
                const isActive = page.id === activeAiPageId;
                const pageStatus = aiPageStatuses.find((s) => s.page_id === page.id);
                const isDone = pageStatus?.state === "ready";
                const isFailed = pageStatus?.state === "invalid";
                const isBuilding = pageStatus && !isDone && !isFailed;
                return (
                  <button
                    key={page.id}
                    onClick={() => setActiveAiPageId(page.id)}
                    className={isActive ? undefined : "btn-ghost"}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "10px 16px",
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? "var(--ink-primary)" : "var(--ink-secondary)",
                      borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                      marginBottom: -1,
                      whiteSpace: "nowrap",
                      transition: "color 0.15s, border-color 0.15s",
                      flexShrink: 0,
                    }}
                  >
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 17,
                      height: 17,
                      borderRadius: "50%",
                      background: isActive ? "var(--accent)" : "var(--bg-secondary)",
                      color: isActive ? "#fff" : "var(--ink-tertiary)",
                      fontSize: 9,
                      fontWeight: 700,
                      flexShrink: 0,
                      boxShadow: isActive ? "none" : "inset 0 0 0 1px var(--line-thin)",
                    }}>
                      {i + 1}
                    </span>
                    {page.title}
                    {isFailed && (
                      <span style={{ fontSize: 10, color: "var(--warn)", flexShrink: 0 }}>!</span>
                    )}
                  </button>
                );
              })}
              {views.map((v) => {
                const isActive = v.id === activeViewId;
                return (
                  <button
                    key={v.id}
                    onClick={() => setActiveViewId(v.id)}
                    className={isActive ? undefined : "btn-ghost"}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      padding: "10px 16px",
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? "var(--ink-primary)" : "var(--ink-secondary)",
                      borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                      marginBottom: -1,
                      whiteSpace: "nowrap",
                      transition: "color 0.15s, border-color 0.15s",
                      flexShrink: 0,
                    }}
                  >
                    {v.view_name}
                  </button>
                );
              })}
            </div>
          )}
          {pendingDraft && activeView ? (
            <div
              style={{
                margin: "0 16px 12px",
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--warn-tint)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--ink-secondary)" }}>
                New source data detected. A layout draft is ready.
              </div>
              <button
                onClick={applyDraft}
                className="btn-solid"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  fontSize: 11,
                  padding: "4px 8px",
                  borderRadius: 4,
                  background: "var(--ink-primary)",
                  color: "white",
                }}
              >
                Apply draft
              </button>
            </div>
          ) : null}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: 20 }}>
          {mounted && loading ? <p>Loading sources...</p> : null}
          {mounted && !loading && !sourceId ? (
            <p style={{ fontSize: 13, color: "var(--ink-tertiary)" }}>Select a source from the left rail to get started.</p>
          ) : null}
          {canvasError ? (
            <div
              style={{
                padding: 12,
                borderRadius: 6,
                background: "var(--danger-tint)",
                color: "var(--ink-secondary)",
                fontSize: 12,
              }}
            >
              {canvasError}
            </div>
          ) : null}
          {showAiOnly ? (
            <div
              style={{
                background: "var(--bg-secondary)",
                borderRadius: "var(--r-card)",
                padding: "20px 16px",
                border: "0.5px solid var(--line-thin)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>AI status</div>
              <div style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                state: <b>{aiStatus.state}</b>
              </div>
              {aiStatus.last_error ? (
                <div style={{ fontSize: 11, color: "var(--ink-secondary)", fontFamily: "monospace", background: "var(--bg-surface)", padding: "6px 8px", borderRadius: 4 }}>
                  {aiStatus.last_error}
                </div>
              ) : null}
              {aiPageStatuses.length > 0 ? (
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--ink-tertiary)" }}>Per-page status</div>
                  {aiPageStatuses.map((ps) => (
                    <div key={ps.page_id} style={{ fontSize: 11, color: ps.state === "invalid" ? "var(--ink-secondary)" : "var(--ink-tertiary)" }}>
                      <b>{ps.page_id}</b>: {ps.state} — {ps.attempts_used} attempts
                      {ps.last_error ? ` — ${ps.last_error}` : ""}
                    </div>
                  ))}
                </div>
              ) : null}
              <button
                onClick={() => { if (sourceId) void fetchCanvas(sourceId, true); }}
                className="btn-solid"
                style={{ all: "unset", cursor: "pointer", marginTop: 4, fontSize: 11, padding: "6px 10px", borderRadius: 4, background: "var(--ink-primary)", color: "white", display: "inline-block" }}
              >
                Retry AI
              </button>
            </div>
          ) : null}
          {generating ? (
            <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: "16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>AI is designing your pages…</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {progressLog.map((step, i) => {
                  if (step.type === "planning") return (
                    <div key={i} style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>⬡ Planning pages from source data…</div>
                  );
                  if (step.type === "plan_ready") return (
                    <div key={i} style={{ fontSize: 11, color: "var(--ink-secondary)" }}>✓ Page plan ready — {step.pages.length} page{step.pages.length !== 1 ? "s" : ""}: {step.pages.map((p) => p.title).join(", ")}</div>
                  );
                  if (step.type === "page_start") return (
                    <div key={i} style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>⬡ Filling <b>{step.title}</b>…</div>
                  );
                  if (step.type === "page_attempt" && step.attempt > 1) return (
                    <div key={i} style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>↺ <b>{step.page_id}</b> attempt {step.attempt}/{step.max_attempts}{step.last_error ? ` — ${step.last_error}` : ""}</div>
                  );
                  if (step.type === "page_done") return (
                    <div key={i} style={{ fontSize: 11, color: "var(--ink-secondary)" }}>✓ <b>{step.title}</b> ready ({step.attempts_used} attempt{step.attempts_used !== 1 ? "s" : ""})</div>
                  );
                  if (step.type === "page_failed") return (
                    <div key={i} style={{ fontSize: 11, color: "var(--ink-secondary)" }}>✗ <b>{step.page_id}</b> failed after {step.attempts_used} attempts</div>
                  );
                  return null;
                })}
              </div>
            </div>
          ) : null}
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
                    const rendered = renderAiComponent(component, index);
                    if (!rendered) return null;
                    return (
                      <AnimatedTile
                        key={`${component.component_id}-${index}`}
                        delay={index * 0.055}
                      >
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
                  <div data-card style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase" }}>Todo</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{todoCount}</div>
                  </div>
                  <div data-card style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase" }}>In Progress</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{inProgressCount}</div>
                  </div>
                  <div data-card style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase" }}>Followed Up</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{followedUpCount}</div>
                  </div>
                  <div data-card style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase" }}>View</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{activeView.view_name}</div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  <div data-card style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase" }}>Rows</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{rows.length}</div>
                  </div>
                  <div data-card style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase" }}>Columns</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{activeColumns.length}</div>
                  </div>
                  <div data-card style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase" }}>
                      Primary Total
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>
                      {primaryTotal === null ? "—" : eur(primaryTotal)}
                    </div>
                  </div>
                  <div data-card style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                    <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase" }}>
                      View
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{activeView.view_name}</div>
                  </div>
                </div>
              )}

              <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 10 }}>
                <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 8 }}>
                  {activeView.view_type === "follow_up_kanban"
                    ? "Follow-up queue"
                    : "Needs attention"}
                </div>
                {attentionRows.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No urgent items detected.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {attentionRows.map((row, idx) => (
                      <div key={`attention-${idx}`} style={{ fontSize: 12, color: "var(--ink-secondary)" }}>
                        {String(row.client_name ?? row.invoice_id ?? `Row ${idx + 1}`)} —{" "}
                        {String(row.status ?? row.follow_up_status ?? "review")}
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
                    <th key={column.id} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "0.5px solid var(--line-thin)", color: "var(--ink-tertiary)", fontWeight: 500 }}>
                      {column.label}
                    </th>
                  ))}
                  <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "0.5px solid var(--line-thin)", color: "var(--ink-tertiary)", fontWeight: 500 }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr className="data-row" key={`${String(row[rowKey] ?? "row")}-${index}`}>
                    {activeColumns.map((column, columnIndex) => {
                      const value = row[column.field];
                      const rendered =
                        column.kind === "number" && typeof value === "number"
                          ? eur(value)
                          : String(value ?? "");
                      return (
                        <td key={`${column.id}-${columnIndex}`} style={{ padding: "10px", borderBottom: "0.5px solid var(--line-thin)" }}>
                          {rendered}
                        </td>
                      );
                    })}
                    <td style={{ padding: "10px", borderBottom: "0.5px solid var(--line-thin)" }}>
                      <button
                        disabled={row.follow_up_status === "followed_up" || !row.invoice_id || !!busy}
                        onClick={() => markFollowedUp(String(row.invoice_id))}
                        className="btn-outline"
                        style={{ all: "unset", cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 4, boxShadow: "inset 0 0 0 0.5px var(--line-strong)", color: "var(--ink-secondary)" }}
                      >
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
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-tertiary)", marginBottom: 8 }}>
                    {lane}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {rows
                      .filter((row) => row.follow_up_status === lane)
                      .map((row, index) => (
                        <div key={String(row.invoice_id ?? index)} style={{ background: "var(--bg-surface)", borderRadius: 4, padding: "8px 9px", boxShadow: "inset 0 0 0 0.5px var(--line-thin)" }}>
                          <div style={{ fontSize: 12, fontWeight: 500 }}>{String(row.invoice_id ?? "Item")}</div>
                          <div style={{ fontSize: 11, color: "var(--ink-secondary)", marginTop: 2 }}>{String(row.client_name ?? "")}</div>
                          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginTop: 2 }}>{typeof row.amount_cents === "number" ? eur(row.amount_cents) : ""}</div>
                          {lane !== "followed_up" ? (
                            <button
                              onClick={() => markFollowedUp(String(row.invoice_id))}
                              className="btn-ghost"
                              style={{ all: "unset", cursor: "pointer", marginTop: 8, fontSize: 11, color: "var(--accent)", padding: "3px 6px", borderRadius: 4 }}
                            >
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

      {/* Right resize handle */}
      <div
        onMouseDown={startDragRight}
        className="drag-handle"
        style={{
          width: 8,
          flexShrink: 0,
          cursor: "col-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
        }}
      >
        <div className="drag-pip" style={{ width: 2, height: 32, borderRadius: 1, background: "var(--line-thin)", opacity: 0.6, transition: "height 0.15s, opacity 0.15s, background 0.15s" }} />
      </div>

      <aside
        style={{
          width: rightWidth,
          flexShrink: 0,
          background: "var(--bg-surface)",
          borderRadius: "var(--r-zone)",
          boxShadow: "inset 0 0 0 0.5px var(--line-thin)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ padding: "13px 16px", borderBottom: "0.5px solid var(--line-thin)", fontSize: 13, fontWeight: 600, flexShrink: 0, letterSpacing: "-0.01em" }}>
          Ask viter
        </div>

        {/* Message history */}
        <div
          ref={steerScrollRef}
          style={{ flex: 1, overflowY: "auto", padding: "14px 14px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}
        >
          {steerMessages.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--ink-tertiary)", lineHeight: 1.6 }}>
              Ask me to change what you see — e.g. &ldquo;show only overdue items&rdquo; or &ldquo;add a chart for totals by client&rdquo;.
            </div>
          ) : null}
          <AnimatePresence initial={false}>
            {steerMessages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 340, damping: 26 }}
                style={{
                  fontSize: 12,
                  lineHeight: 1.6,
                  padding: "8px 11px",
                  borderRadius: 10,
                  background: msg.role === "user" ? "var(--accent)" : "var(--bg-secondary)",
                  color: msg.role === "user" ? "white" : "var(--ink-secondary)",
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  boxShadow: msg.role === "user" ? "0 1px 4px rgba(47,91,255,0.18)" : "none",
                }}
              >
                {msg.content}
              </motion.div>
            ))}
          </AnimatePresence>
          {steering ? (
            <div style={{ alignSelf: "flex-start", width: "88%", display: "flex", flexDirection: "column", gap: 8, padding: "10px 0" }}>
              <div className="chat-skeleton-line" style={{ width: "100%" }} />
              <div className="chat-skeleton-line" style={{ width: "82%" }} />
              <div className="chat-skeleton-line" style={{ width: "91%" }} />
              <div className="chat-skeleton-line" style={{ width: "67%" }} />
              <div className="chat-skeleton-line" style={{ width: "78%" }} />
              <div className="chat-hint-cycle" style={{ marginTop: 2, fontSize: 11, color: "var(--ink-tertiary)" }}>
                {STEER_HINTS[steerHintIdx]}
              </div>
            </div>
          ) : null}
        </div>

        {/* Input */}
        <div style={{ padding: "10px 12px 12px", borderTop: "0.5px solid var(--line-thin)", flexShrink: 0 }}>
          <div style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 0,
            borderRadius: 10,
            border: "1px solid var(--line-strong)",
            background: "var(--bg-secondary)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            overflow: "hidden",
            transition: "border-color 0.15s",
          }}>
            <input
              value={steerInput}
              onChange={(e) => setSteerInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendSteerMessage(); } }}
              placeholder="Ask to change the view…"
              disabled={steering || !sourceId || aiPages.length === 0}
              style={{
                flex: 1,
                fontSize: 12,
                padding: "10px 12px",
                border: "none",
                background: "transparent",
                color: "var(--ink-primary)",
                outline: "none",
                minWidth: 0,
              }}
            />
            <button
              onClick={() => void sendSteerMessage()}
              disabled={steering || !steerInput.trim() || !sourceId || aiPages.length === 0}
              className={(!steering && steerInput.trim()) ? "btn-solid" : undefined}
              style={{
                all: "unset",
                cursor: steering || !steerInput.trim() ? "default" : "pointer",
                fontSize: 14,
                width: 36,
                height: 36,
                margin: 4,
                borderRadius: 7,
                background: steering || !steerInput.trim() ? "var(--bg-tertiary)" : "var(--ink-primary)",
                color: steering || !steerInput.trim() ? "var(--ink-quaternary)" : "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                transition: "background 0.15s, color 0.15s",
              }}
            >
              ↑
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
