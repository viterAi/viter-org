"use client";

import { useState, useCallback } from "react";
import type { AiComponent, Row, UiColumn } from "../types";
import { eur } from "../utils";

type GanttTask = {
  title?: string;
  name?: string;
  label?: string;
  start?: string;
  end?: string;
  status?: string;
  [key: string]: unknown;
};

const STATUS_COLORS: Record<string, string> = {
  done:        "var(--color-status-done)",
  complete:    "var(--color-status-done)",
  completed:   "var(--color-status-done)",
  in_progress: "var(--color-status-active)",
  active:      "var(--color-status-active)",
  blocked:     "var(--color-status-blocked)",
  at_risk:     "var(--color-status-at-risk)",
  pending:     "var(--color-status-pending)",
  planned:     "var(--color-status-pending)",
};

function ganttColor(status: string) {
  return STATUS_COLORS[status.toLowerCase()] ?? "var(--accent)";
}

function fmtGanttDate(ts: number) {
  const d = new Date(ts);
  return `${d.toLocaleString("default", { month: "short" })} ${d.getDate()}`;
}

function GanttChart({
  title, tasks, cardStyle, rows,
  titleField, startField, endField, statusField, maxItems,
  onAgentAction,
}: {
  title: string;
  tasks: GanttTask[];
  cardStyle: React.CSSProperties;
  rows?: Row[];
  titleField?: string;
  startField?: string;
  endField?: string;
  statusField?: string;
  maxItems?: number;
  onAgentAction?: (message?: string) => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [cmdInput, setCmdInput] = useState("");
  const [cmdFocused, setCmdFocused] = useState(false);

  // Derive tasks from real row data when field mappings are provided and static tasks are empty
  const effectiveTasks: GanttTask[] = (() => {
    if (tasks.length > 0) return tasks;
    if (!rows || rows.length === 0 || !startField || !endField) return [];
    const limit = maxItems ?? 30;
    return rows.slice(0, limit).map((r) => ({
      title: titleField ? String(r[titleField] ?? "Task") : "Task",
      start: startField ? String(r[startField] ?? "") : "",
      end: endField ? String(r[endField] ?? "") : "",
      status: statusField ? String(r[statusField] ?? "") : "",
    }));
  })();

  const parsed = effectiveTasks
    .map((t) => ({
      title: String(t.title ?? t.name ?? t.label ?? "Task"),
      start: t.start ? Date.parse(t.start) : NaN,
      end: t.end ? Date.parse(t.end) : NaN,
      status: String(t.status ?? ""),
    }))
    .filter((t) => !isNaN(t.start) && !isNaN(t.end) && t.end >= t.start);

  if (parsed.length === 0) {
    const hint = (!startField && tasks.length === 0)
      ? "Set start_field and end_field in the spec to map date columns from your data."
      : "No rows with valid start and end dates found.";
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>{hint}</div>
      </div>
    );
  }

  const minTime = Math.min(...parsed.map((t) => t.start));
  const maxTime = Math.max(...parsed.map((t) => t.end));
  const range = maxTime - minTime || 1;
  const selected = selectedIdx !== null ? parsed[selectedIdx] : null;
  const uniqueStatuses = [...new Set(parsed.map((t) => t.status).filter(Boolean))];

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 10 }}>{title}</div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--ink-quaternary, var(--ink-tertiary))", marginBottom: 6, paddingLeft: 100 }}>
        <span>{fmtGanttDate(minTime)}</span>
        <span>{fmtGanttDate(maxTime)}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {parsed.map((task, i) => {
          const leftPct = ((task.start - minTime) / range) * 100;
          const widthPct = Math.max(((task.end - task.start) / range) * 100, 2);
          const color = ganttColor(task.status);
          const isSelected = selectedIdx === i;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 92, fontSize: 11, color: "var(--ink-secondary)", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.title}>
                {task.title}
              </div>
              <div style={{ flex: 1, position: "relative", height: 20, background: "var(--bg-surface)", borderRadius: 3 }}>
                <div
                  onClick={() => setSelectedIdx(isSelected ? null : i)}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    height: "100%",
                    background: color,
                    borderRadius: 3,
                    cursor: "pointer",
                    opacity: isSelected ? 1 : 0.75,
                    outline: isSelected ? `2px solid ${color}` : "none",
                    outlineOffset: 2,
                    transition: "opacity 0.15s",
                  }}
                  title={`${task.title}: ${fmtGanttDate(task.start)} – ${fmtGanttDate(task.end)}`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {selected ? (
        <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 4, background: "var(--bg-surface)", boxShadow: "inset 0 0 0 0.5px var(--line-thin)" }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{selected.title}</div>
          <div style={{ fontSize: 11, color: "var(--ink-secondary)", marginTop: 3 }}>
            {fmtGanttDate(selected.start)} → {fmtGanttDate(selected.end)}
          </div>
          {selected.status ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: ganttColor(selected.status), flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--ink-secondary)" }}>{selected.status}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 10, color: "var(--ink-quaternary, var(--ink-tertiary))", textAlign: "center" }}>
          Click a bar to see details
        </div>
      )}

      {uniqueStatuses.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 8 }}>
          {uniqueStatuses.map((s) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--ink-tertiary)" }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: ganttColor(s), flexShrink: 0 }} />
              {s}
            </div>
          ))}
        </div>
      ) : null}

      {/* Inline command bar */}
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          borderRadius: 6,
          border: `1px solid ${cmdFocused ? "var(--accent)" : "var(--line-thin)"}`,
          background: "var(--bg-surface)",
          transition: "border-color 0.15s",
          overflow: "hidden",
        }}>
          <svg style={{ flexShrink: 0, margin: "0 7px", opacity: 0.4 }} width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M7.5 7.5L10 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            value={cmdInput}
            onChange={(e) => setCmdInput(e.target.value)}
            onFocus={() => setCmdFocused(true)}
            onBlur={() => setCmdFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && cmdInput.trim()) {
                e.preventDefault();
                onAgentAction?.(cmdInput.trim());
                setCmdInput("");
              }
              if (e.key === "Escape") {
                setCmdInput("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Ask to filter, change dates, or load data…"
            style={{
              flex: 1, fontSize: 11, padding: "7px 8px 7px 0",
              border: "none", background: "transparent",
              color: "var(--ink-primary)", outline: "none", minWidth: 0,
            }}
          />
        </div>
        {cmdInput.trim() && (
          <button
            onClick={() => { onAgentAction?.(cmdInput.trim()); setCmdInput(""); }}
            style={{
              all: "unset", cursor: "pointer",
              fontSize: 11, padding: "6px 10px", borderRadius: 6,
              background: "var(--accent)", color: "#fff",
              flexShrink: 0, transition: "opacity 0.12s",
            }}
          >
            Ask
          </button>
        )}
      </div>
    </div>
  );
}

function FilterBar({ card, title, fields, onAgentAction }: {
  card: React.CSSProperties;
  title: string;
  fields: unknown[];
  onAgentAction?: (message?: string) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
        onAgentAction?.();
      }
      return next;
    });
  }, [onAgentAction]);

  return (
    <div style={{ ...card, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "var(--ink-tertiary)", flexShrink: 0 }}>{title}</span>
      {fields.map((f, fi) => {
        const label = typeof f === "object" && f !== null
          ? String((f as Record<string, unknown>).label ?? (f as Record<string, unknown>).name ?? JSON.stringify(f))
          : String(f);
        const isOn = selected.has(fi);
        return (
          <button
            key={fi}
            onClick={() => toggle(fi)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 11,
              borderRadius: 12,
              padding: "3px 10px",
              background: isOn ? "var(--accent)" : "var(--bg-surface)",
              color: isOn ? "#fff" : "var(--ink-secondary)",
              border: isOn ? "0.5px solid var(--accent)" : "0.5px solid var(--line-thin)",
              transition: "background 0.15s, color 0.15s, border-color 0.15s",
              fontWeight: isOn ? 600 : 400,
            }}
          >
            {label}
          </button>
        );
      })}
      {fields.length === 0 && <span style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>No filters defined.</span>}
    </div>
  );
}

/**
 * Spec-mapper sets metric `value` to the field key so the renderer can resolve
 * the actual value from row data at display time. This function handles that
 * resolution: if `raw` matches a field in rows, aggregate; otherwise return as-is.
 */
function resolveMetricValue(raw: string, format: string, rows: Row[]): string {
  if (!raw) return "—";

  // Check if `raw` looks like a literal value (has spaces, digits with units, starts with number, etc.)
  const looksLiteral = /\s/.test(raw) || /^\d/.test(raw) || raw.includes("€") || raw.includes("$") || raw.includes("%");
  if (looksLiteral) return raw;

  // Check if this field exists in any row
  const fieldExists = rows.length > 0 && rows.some((r) => raw in r);
  if (!fieldExists) {
    // Field doesn't exist in data — show "—" instead of the raw field name
    return "—";
  }

  // Aggregate the field based on format
  const values = rows.map((r) => r[raw]);

  if (format === "percent") {
    const truthy = values.filter((v) => v && v !== "0" && v !== "false" && v !== "").length;
    return `${Math.round((truthy / values.length) * 100)}%`;
  }

  if (format === "currency" || format === "number") {
    const nums = values.map((v) => (typeof v === "number" ? v : parseFloat(String(v ?? 0)))).filter((n) => !isNaN(n));
    if (nums.length === 0) return "—";
    const total = nums.reduce((s, n) => s + n, 0);
    if (format === "currency") return eur(total);
    return total.toLocaleString();
  }

  // For count / text: count non-empty rows
  const count = values.filter((v) => v != null && v !== "" && v !== false).length;
  return String(count);
}

interface AiComponentRendererProps {
  component: AiComponent;
  index: number;
  rows: Row[];
  activeColumns: UiColumn[];
  attentionRows: Row[];
  isRefreshing?: boolean;
  onAgentAction?: (message?: string) => void;
}

/**
 * Inner rendering logic — no knowledge of the refresh state.
 * Static components are rendered here and never receive the scan-line overlay.
 */
function AiComponentBody({
  component,
  index,
  rows,
  activeColumns,
  attentionRows,
  onAgentAction,
}: Omit<AiComponentRendererProps, "isRefreshing">) {
  const cid = component.component_id;
  const props = component.props ?? {};
  const k = `${cid}-${index}`;
  const card: React.CSSProperties = {
    background: "var(--bg-secondary)",
    borderRadius: "var(--r-card)",
    padding: 12,
  };

  if (cid === "text_block") {
    const body = String(props.body ?? "");
    if (!body) return null;
    return (
      <div key={k} style={card}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{String(props.title ?? "")}</div>
        <div style={{ marginTop: props.title ? 6 : 0, fontSize: 12, color: "var(--ink-secondary)", lineHeight: 1.6 }}>{body}</div>
      </div>
    );
  }

  if (cid === "kpi_row") {
    const metrics = Array.isArray(props.metrics) ? props.metrics : [];
    const resolved = metrics.slice(0, 4).map((m) => {
      const item = (m ?? {}) as Record<string, unknown>;
      return { label: String(item.label ?? "Metric"), value: resolveMetricValue(String(item.value ?? ""), String(item.format ?? "text"), rows) };
    }).filter((m) => m.value !== "—");
    if (resolved.length === 0) return null;
    return (
      <div key={k} style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(resolved.length, 4)}, 1fr)`, gap: 8 }}>
        {resolved.map((m, mi) => (
          <div key={`kpi-${mi}`} style={card}>
            <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{m.value}</div>
          </div>
        ))}
      </div>
    );
  }

  if (cid === "metric_card") {
    const metrics = Array.isArray(props.metrics) ? props.metrics : null;
    if (metrics && metrics.length > 0) {
      const resolved = metrics.slice(0, 4).map((m) => {
        const item = (m ?? {}) as Record<string, unknown>;
        return { label: String(item.label ?? "Metric"), value: resolveMetricValue(String(item.value ?? ""), String(item.format ?? "text"), rows), hint: item.hint ? String(item.hint) : null };
      }).filter((m) => m.value !== "—");
      if (resolved.length === 0) return null;
      return (
        <div key={k} style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(resolved.length, 4)}, 1fr)`, gap: 8 }}>
          {resolved.map((m, mi) => (
            <div key={`mc-${mi}`} style={card}>
              <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{m.value}</div>
              {m.hint && <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginTop: 2 }}>{m.hint}</div>}
            </div>
          ))}
        </div>
      );
    }
    const resolved = resolveMetricValue(String(props.value ?? ""), "text", rows);
    if (resolved === "—") return null;
    return (
      <div key={k} style={{ ...card, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{String(props.label ?? "Metric")}</div>
        <div style={{ fontSize: 26, fontWeight: 700 }}>{resolved}</div>
        {props.hint ? <div style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>{String(props.hint)}</div> : null}
      </div>
    );
  }

  if (cid === "attention_list" || cid === "activity_feed") {
    const title = String(props.title ?? (cid === "attention_list" ? "Needs attention" : "Activity"));
    const labelField = props.label_field ? String(props.label_field) : null;
    const detailField = props.detail_field ? String(props.detail_field) : null;

    // Priority: explicit items → label_field from rows → generic row fallback
    const items: unknown[] = Array.isArray(props.items) && (props.items as unknown[]).length > 0
      ? props.items
      : labelField && rows.some((r) => labelField in r)
        ? rows.map((r) => {
            const name = r[labelField] != null ? String(r[labelField]) : null;
            if (!name) return null;
            const detail = detailField && r[detailField] != null ? String(r[detailField]) : null;
            return detail ? `${name} — ${detail}` : name;
          }).filter(Boolean)
        : attentionRows.map((r) => {
            const name = String(r.client_name ?? r.invoice_id ?? r.title ?? r.name ?? r.sender ?? "");
            const status = String(r.status ?? r.follow_up_status ?? r.kind ?? "");
            if (!name && !status) return null;
            if (!name) return status;
            if (!status) return name;
            return `${name} — ${status}`;
          }).filter(Boolean);
    if (items.length === 0) return null;
    const visible = items.slice(0, Number(props.max_items ?? 6));
    if (visible.length === 0) return null;
    return (
      <div key={k} style={card}>
        <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 8 }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {visible.map((item, ii) => {
            const label = typeof item === "object" && item !== null
              ? String((item as Record<string, unknown>).title ?? (item as Record<string, unknown>).name ?? (item as Record<string, unknown>).label ?? (item as Record<string, unknown>).message ?? (item as Record<string, unknown>).text ?? (item as Record<string, unknown>).description ?? JSON.stringify(item))
              : String(item);
            if (!label) return null;
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

  if (cid === "filter_bar") {
    const fields: unknown[] = Array.isArray(props.fields) ? props.fields : [];
    if (fields.length === 0) return null;
    return (
      <FilterBar
        key={k}
        card={card}
        title={String(props.title ?? "Filters")}
        fields={fields}
        onAgentAction={onAgentAction}
      />
    );
  }

  if (cid === "chart_gantt") {
    const tasks = Array.isArray(props.tasks) ? (props.tasks as GanttTask[]) : [];
    const hasFields = props.start_field && props.end_field;
    // If no static tasks and no field mappings, nothing to render
    if (tasks.length === 0 && !hasFields) return null;
    return (
      <GanttChart
        key={k}
        title={String(props.title ?? "Timeline")}
        tasks={tasks}
        cardStyle={card}
        rows={rows}
        titleField={props.title_field ? String(props.title_field) : undefined}
        startField={props.start_field ? String(props.start_field) : undefined}
        endField={props.end_field ? String(props.end_field) : undefined}
        statusField={props.status_field ? String(props.status_field) : undefined}
        maxItems={props.max_items ? Number(props.max_items) : undefined}
        onAgentAction={onAgentAction}
      />
    );
  }

  if (cid === "chart_bar") {
    const groupBy = String(props.group_by ?? "");
    const valueField = String(props.value_field ?? "");
    if (rows.length === 0 || !groupBy) return null;
    const fieldExists = rows.some((r) => groupBy in r && r[groupBy] != null);
    if (!fieldExists) return null;
    const agg: Record<string, number> = {};
    for (const row of rows) {
      const gk = String(row[groupBy] ?? "other");
      const v = typeof row[valueField] === "number" ? (row[valueField] as number) : 1;
      agg[gk] = (agg[gk] ?? 0) + v;
    }
    const entries = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8);
    // Single bucket named "other" means the field had no real values — hide
    if (entries.length === 0 || (entries.length === 1 && entries[0][0] === "other")) return null;
    const maxV = Math.max(...entries.map(([, v]) => v), 1);
    return (
      <div key={k} style={card}>
        <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 10 }}>{String(props.title ?? groupBy)}</div>
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

  if (cid === "chart_line") {
    const xField = String(props.x_field ?? "");
    const yField = String(props.y_field ?? "");
    if (rows.length === 0 || !xField) return null;
    const fieldExists = rows.some((r) => xField in r && r[xField] != null);
    if (!fieldExists) return null;
    const agg: Record<string, number> = {};
    for (const row of rows) {
      const xk = String(row[xField] ?? "");
      const v = typeof row[yField] === "number" ? (row[yField] as number) : 1;
      if (xk) agg[xk] = (agg[xk] ?? 0) + v;
    }
    const entries = Object.entries(agg).sort(([a], [b]) => a.localeCompare(b)).slice(0, 14);
    if (entries.length === 0) return null;
    const maxV = Math.max(...entries.map(([, v]) => v), 1);
    return (
      <div key={k} style={card}>
        <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 10 }}>{String(props.title ?? `${yField} over time`)}</div>
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
      </div>
    );
  }

  if (cid === "chart_donut") {
    const groupBy = String(props.group_by ?? "");
    const valueField = String(props.value_field ?? "");
    if (rows.length === 0 || !groupBy) return null;
    const fieldExists = rows.some((r) => groupBy in r && r[groupBy] != null);
    if (!fieldExists) return null;
    const agg: Record<string, number> = {};
    for (const row of rows) {
      const gk = String(row[groupBy] ?? "other");
      const v = typeof row[valueField] === "number" ? (row[valueField] as number) : 1;
      agg[gk] = (agg[gk] ?? 0) + v;
    }
    const entries = Object.entries(agg);
    if (entries.length === 0 || (entries.length === 1 && entries[0][0] === "other")) return null;
    const total = entries.reduce((s, [, v]) => s + v, 0);
    const PALETTE = ["var(--accent)", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];
    return (
      <div key={k} style={card}>
        <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 10 }}>{String(props.title ?? groupBy)}</div>
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
      </div>
    );
  }

  if (cid === "kanban_board") {
    if (rows.length === 0) return null;
    const groupBy = String(props.group_by ?? "follow_up_status");
    const fieldExists = rows.some((r) => groupBy in r && r[groupBy] != null);
    if (!fieldExists) return null;
    const titleField = String(props.title_field ?? "invoice_id");
    const subtitleField = String(props.subtitle_field ?? "client_name");
    const valueField = String(props.value_field ?? "amount_cents");
    const lanesProp = Array.isArray(props.lanes) ? props.lanes.map(String) : null;
    const uniqueGroups = [...new Set(rows.map((r) => String(r[groupBy] ?? "other")))].filter((g) => g !== "other");
    const laneKeys = lanesProp ?? uniqueGroups.slice(0, 4);
    if (laneKeys.length === 0) return null;
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

  if (cid === "entity_cards") {
    if (rows.length === 0) return null;
    const titleField = String(props.title_field ?? "client_name");
    // Verify the title field actually exists in the data
    const titleFieldExists = rows.some((r) => titleField in r && r[titleField] != null);
    if (!titleFieldExists) return null;
    const subtitleField = String(props.subtitle_field ?? "");
    const valueField = String(props.value_field ?? "");
    const rankBy = props.rank_by ? String(props.rank_by) : null;
    const rankDir = String(props.rank_direction ?? "desc");
    const maxItems = Number(props.max_items ?? 6);
    const colDefs = Array.isArray(props.columns) ? (props.columns as Array<Record<string, unknown>>) : null;
    const sorted = rankBy
      ? [...rows].sort((a, b) => {
          const av = a[rankBy], bv = b[rankBy];
          if (typeof av === "number" && typeof bv === "number") return rankDir === "asc" ? av - bv : bv - av;
          return rankDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        })
      : rows;
    const cards = sorted.slice(0, maxItems);
    if (cards.length === 0) return null;
    const headerTitle = props.title ? String(props.title) : null;
    return (
      <div key={k} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {headerTitle && <div style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>{headerTitle}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {cards.map((r, ri) => (
            <div key={ri} style={{ ...card, display: "flex", flexDirection: "column", gap: 3 }}>
              {colDefs ? (
                colDefs.map((col, ci) => {
                  const field = String(col.field ?? col.id ?? "");
                  const label = col.label ? String(col.label) : null;
                  const val = r[field];
                  if (val == null) return null;
                  return (
                    <div key={ci}>
                      {label && ci > 0 && <div style={{ fontSize: 10, color: "var(--ink-tertiary)" }}>{label}</div>}
                      <div style={{ fontSize: ci === 0 ? 13 : 11, fontWeight: ci === 0 ? 600 : 400, color: ci === 0 ? "var(--ink-primary)" : "var(--ink-secondary)" }}>
                        {String(col.kind) === "number" && typeof val === "number" && field.includes("cents") ? eur(val) : String(val)}
                      </div>
                    </div>
                  );
                })
              ) : (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{String(r[titleField] ?? "—")}</div>
                  {subtitleField && r[subtitleField] != null ? <div style={{ fontSize: 11, color: "var(--ink-secondary)" }}>{String(r[subtitleField])}</div> : null}
                  {valueField && r[valueField] != null ? (
                    <div style={{ fontSize: 12, color: "var(--ink-tertiary)", marginTop: 2 }}>
                      {valueField.includes("cents") && typeof r[valueField] === "number" ? eur(r[valueField] as number) : String(r[valueField])}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (cid === "action_panel") {
    const actions: unknown[] = Array.isArray(props.actions) ? props.actions : [];
    if (actions.length === 0) return null;
    return (
      <div key={k} style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>{String(props.title ?? "Actions")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {actions.map((a, ai) => {
            const label = typeof a === "object" && a !== null ? String((a as Record<string, unknown>).label ?? (a as Record<string, unknown>).name ?? JSON.stringify(a)) : String(a);
            return (
              <button
                key={ai}
                onClick={() => onAgentAction?.()}
                style={{ all: "unset", cursor: "pointer", fontSize: 12, padding: "6px 12px", borderRadius: 4, boxShadow: "inset 0 0 0 0.5px var(--line-strong)", color: "var(--ink-secondary)", transition: "background 0.12s, color 0.12s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-tertiary, var(--bg-secondary))"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ""; }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (cid === "empty_state") {
    return (
      <div key={k} style={{ ...card, textAlign: "center", padding: "32px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{String(props.title ?? "Nothing here")}</div>
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-secondary)" }}>{String(props.message ?? "")}</div>
      </div>
    );
  }

  if (cid === "data_table") {
    if (rows.length === 0) {
      return (
        <div key={k} style={{ overflowX: "auto" }}>
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)", padding: 12 }}>No data available.</div>
        </div>
      );
    }
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

  // Unknown component type — render nothing rather than a confusing placeholder.
  return null;
}

/**
 * Public component.
 *
 * When `isRefreshing=true` (dynamic component whose trigger has fired):
 *   - a scan-line overlay appears at the top of the component
 *   - static components always render without the overlay
 *
 * The wrapper div uses `position: relative` so the absolutely-positioned scan-line
 * clips correctly against the component bounding box without affecting layout.
 */
export function AiComponentRenderer({
  isRefreshing = false,
  ...rest
}: AiComponentRendererProps) {
  return (
    <div style={{ position: "relative" }}>
      {isRefreshing && <div className="dynamic-refreshing-bar" />}
      <AiComponentBody {...rest} />
    </div>
  );
}
