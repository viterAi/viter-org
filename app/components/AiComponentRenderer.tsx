"use client";

import { useState } from "react";
import type { Row, UiColumn } from "../types";
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

function GanttChart({ title, tasks, cardStyle }: { title: string; tasks: GanttTask[]; cardStyle: React.CSSProperties }) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const parsed = tasks
    .map((t) => ({
      title: String(t.title ?? t.name ?? t.label ?? "Task"),
      start: t.start ? Date.parse(t.start) : NaN,
      end: t.end ? Date.parse(t.end) : NaN,
      status: String(t.status ?? ""),
    }))
    .filter((t) => !isNaN(t.start) && !isNaN(t.end));

  if (parsed.length === 0) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No task data available.</div>
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
    </div>
  );
}

type ComponentNode = { component_id: string; props?: Record<string, unknown> };

export function AiComponentRenderer({
  component,
  index,
  rows,
  activeColumns,
  attentionRows,
}: {
  component: ComponentNode;
  index: number;
  rows: Row[];
  activeColumns: UiColumn[];
  attentionRows: Row[];
}) {
  const cid = component.component_id;
  const props = component.props ?? {};
  const k = `${cid}-${index}`;
  const card: React.CSSProperties = {
    background: "var(--bg-secondary)",
    borderRadius: "var(--r-card)",
    padding: 12,
  };

  if (cid === "text_block") {
    return (
      <div key={k} style={card}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{String(props.title ?? "Text")}</div>
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-secondary)", lineHeight: 1.6 }}>{String(props.body ?? "")}</div>
      </div>
    );
  }

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

  if (cid === "metric_card") {
    return (
      <div key={k} style={{ ...card, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 10, color: "var(--ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{String(props.label ?? "Metric")}</div>
        <div style={{ fontSize: 26, fontWeight: 700 }}>{props.value != null && props.value !== "" ? String(props.value) : "—"}</div>
        {props.hint ? <div style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>{String(props.hint)}</div> : null}
      </div>
    );
  }

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

  if (cid === "chart_gantt") {
    const tasks = Array.isArray(props.tasks) ? (props.tasks as GanttTask[]) : [];
    return <GanttChart key={k} title={String(props.title ?? "Timeline")} tasks={tasks} cardStyle={card} />;
  }

  if (cid === "chart_bar") {
    const groupBy = String(props.group_by ?? "");
    const valueField = String(props.value_field ?? "");
    if (rows.length === 0 || !groupBy) {
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 6 }}>{String(props.title ?? (groupBy || "Bar chart"))}</div>
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No data available.</div>
        </div>
      );
    }
    const agg: Record<string, number> = {};
    for (const row of rows) {
      const gk = String(row[groupBy] ?? "other");
      const v = typeof row[valueField] === "number" ? (row[valueField] as number) : 1;
      agg[gk] = (agg[gk] ?? 0) + v;
    }
    const entries = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (entries.length === 0) {
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 6 }}>{String(props.title ?? (groupBy || "Bar chart"))}</div>
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No data available.</div>
        </div>
      );
    }
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

  if (cid === "chart_line") {
    const xField = String(props.x_field ?? "");
    const yField = String(props.y_field ?? "");
    if (rows.length === 0 || !xField) {
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 6 }}>{String(props.title ?? `${yField} over time`)}</div>
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No data available.</div>
        </div>
      );
    }
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
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No data available.</div>
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

  if (cid === "chart_donut") {
    const groupBy = String(props.group_by ?? "");
    const valueField = String(props.value_field ?? "");
    if (rows.length === 0 || !groupBy) {
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 6 }}>{String((props.title ?? groupBy) || "Composition")}</div>
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No data available.</div>
        </div>
      );
    }
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

  if (cid === "kanban_board") {
    if (rows.length === 0) {
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", marginBottom: 6 }}>Board</div>
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No data available.</div>
        </div>
      );
    }
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

  if (cid === "entity_cards") {
    if (rows.length === 0) {
      return (
        <div key={k} style={card}>
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>No data available.</div>
        </div>
      );
    }
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

  return (
    <div key={k} style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: 12, fontSize: 12, color: "var(--ink-tertiary)", fontStyle: "italic" }}>
      [{cid}]
    </div>
  );
}
