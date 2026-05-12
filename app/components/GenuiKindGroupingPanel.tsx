"use client";

/**
 * Corn-jobs admin: list every cached `genui_kind_grouping` row and let the
 * user override `group_field` / `group_label` / `display_regex` or trigger a
 * re-inference on the next ingest tick.
 *
 * Wired to `/api/genui/kind-grouping` (GET / POST). The route is RLS-guarded
 * to authenticated users; writes set `confidence: "admin"`.
 */
import React, { useCallback, useEffect, useState } from "react";
import type { KindGrouping } from "../types";

const CONFIDENCE_TINT: Record<KindGrouping["confidence"], { bg: string; fg: string; label: string }> = {
  seed:      { bg: "#e0eaff", fg: "#1d4ed8", label: "Seed" },
  ai:        { bg: "#e6f4ea", fg: "#137333", label: "AI" },
  heuristic: { bg: "#fef2cd", fg: "#a16207", label: "Heuristic" },
  admin:     { bg: "#f3e8ff", fg: "#6d28d9", label: "Manual" },
};

const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function GenuiKindGroupingPanel() {
  const [rows, setRows] = useState<KindGrouping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [editingKind, setEditingKind] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/genui/kind-grouping");
      if (!res.ok) {
        setError(`Failed to load grouping config: ${res.status}`);
        return;
      }
      const json = (await res.json()) as { groupings?: KindGrouping[] };
      setRows((json.groupings ?? []).sort((a, b) => a.kind.localeCompare(b.kind)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  async function reInfer(kind: string) {
    if (!confirm(`Re-detect grouping for "${kind}"?\n\nThis clears the cached row so the next ingest tick re-runs AI inference.`)) {
      return;
    }
    setBusyKind(kind);
    try {
      const res = await fetch("/api/genui/kind-grouping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, re_infer: true }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(err.error ?? `Re-detect failed: ${res.status}`);
      } else {
        await fetchRows();
      }
    } finally {
      setBusyKind(null);
    }
  }

  async function saveOverride(kind: string, override: {
    group_field: string;
    group_label: string;
    timestamp_field: string | null;
    display_regex: string | null;
  }) {
    setBusyKind(kind);
    try {
      const res = await fetch("/api/genui/kind-grouping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, ...override }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setError(err.error ?? `Save failed: ${res.status}`);
        return false;
      }
      await fetchRows();
      return true;
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <section style={{
      marginTop: 24,
      borderRadius: "var(--r-card, 12px)",
      border: "0.5px solid var(--line-thin)",
      background: "var(--bg-surface)",
      padding: 16,
    }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--ink-primary)" }}>
            Sidebar grouping
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-tertiary)", maxWidth: 560 }}>
            Each service kind has an inferred payload field that the sidebar groups L2 rows by
            (Gmail → senders, WhatsApp → chats…). Override the field or re-detect if a service guesses wrong.
          </p>
        </div>
        <button
          onClick={() => void fetchRows()}
          className="btn-ghost"
          style={{ all: "unset", cursor: "pointer", fontSize: 12, color: "var(--ink-secondary)", padding: "4px 8px", borderRadius: 4 }}
        >
          Refresh
        </button>
      </header>

      {error && (
        <div style={{
          marginBottom: 12,
          padding: "8px 10px",
          fontSize: 12,
          background: "#fef2f2",
          color: "#b91c1c",
          border: "0.5px solid #fecaca",
          borderRadius: 6,
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--ink-tertiary)" }}>
          No grouping rows yet. The ingest worker creates them automatically on first L2 insert for a new kind.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((row) => (
            editingKind === row.kind ? (
              <EditRow
                key={row.kind}
                row={row}
                busy={busyKind === row.kind}
                onCancel={() => setEditingKind(null)}
                onSave={async (override) => {
                  const ok = await saveOverride(row.kind, override);
                  if (ok) setEditingKind(null);
                }}
              />
            ) : (
              <DisplayRow
                key={row.kind}
                row={row}
                busy={busyKind === row.kind}
                onEdit={() => setEditingKind(row.kind)}
                onReInfer={() => void reInfer(row.kind)}
              />
            )
          ))}
        </div>
      )}
    </section>
  );
}

function DisplayRow({
  row, busy, onEdit, onReInfer,
}: {
  row: KindGrouping;
  busy: boolean;
  onEdit: () => void;
  onReInfer: () => void;
}) {
  const tint = CONFIDENCE_TINT[row.confidence];
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "100px 1fr auto",
      alignItems: "center",
      gap: 12,
      padding: "10px 12px",
      borderRadius: 8,
      border: "0.5px solid var(--line-thin)",
      background: "var(--bg-secondary, transparent)",
    }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-primary)" }}>
        {row.kind}
      </div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: 12, color: "var(--ink-secondary)" }}>
        <span title="Field grouped on" style={{ fontFamily: "var(--font-mono, monospace)", background: "var(--bg-surface)", padding: "2px 6px", borderRadius: 4 }}>
          {row.group_field}
        </span>
        <span style={{ color: "var(--ink-tertiary)" }}>→</span>
        <span>{row.group_label}</span>
        {row.timestamp_field && (
          <>
            <span style={{ color: "var(--ink-tertiary)" }}>·</span>
            <span style={{ color: "var(--ink-tertiary)" }}>sort by <code>{row.timestamp_field}</code></span>
          </>
        )}
        {row.display_regex && (
          <>
            <span style={{ color: "var(--ink-tertiary)" }}>·</span>
            <span style={{ color: "var(--ink-tertiary)" }} title={row.display_regex}>regex</span>
          </>
        )}
        <span style={{
          marginLeft: 4,
          padding: "1px 6px",
          fontSize: 10,
          borderRadius: 10,
          background: tint.bg,
          color: tint.fg,
        }}>
          {tint.label}
        </span>
        {row.last_error && (
          <span style={{ marginLeft: 4, fontSize: 11, color: "#b91c1c" }} title={row.last_error}>
            (warning)
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={onEdit}
          disabled={busy}
          className="btn-ghost"
          style={{ all: "unset", cursor: busy ? "default" : "pointer", padding: "4px 8px", fontSize: 12, borderRadius: 4, color: "var(--ink-secondary)" }}
        >
          Edit
        </button>
        <button
          onClick={onReInfer}
          disabled={busy}
          className="btn-ghost"
          style={{ all: "unset", cursor: busy ? "default" : "pointer", padding: "4px 8px", fontSize: 12, borderRadius: 4, color: "var(--ink-secondary)" }}
        >
          {busy ? "…" : "Re-detect"}
        </button>
      </div>
    </div>
  );
}

function EditRow({
  row, busy, onCancel, onSave,
}: {
  row: KindGrouping;
  busy: boolean;
  onCancel: () => void;
  onSave: (override: {
    group_field: string;
    group_label: string;
    timestamp_field: string | null;
    display_regex: string | null;
  }) => Promise<void>;
}) {
  const [groupField, setGroupField] = useState(row.group_field);
  const [groupLabel, setGroupLabel] = useState(row.group_label);
  const [timestampField, setTimestampField] = useState(row.timestamp_field ?? "");
  const [displayRegex, setDisplayRegex] = useState(row.display_regex ?? "");
  const [validation, setValidation] = useState<string | null>(null);

  function validate(): { ok: true; payload: Parameters<typeof onSave>[0] } | { ok: false; reason: string } {
    if (!FIELD_RE.test(groupField.trim())) return { ok: false, reason: "Group field must be a JSON field name (letters, digits, _)." };
    if (!groupLabel.trim()) return { ok: false, reason: "Group label is required." };
    if (timestampField.trim() && !FIELD_RE.test(timestampField.trim())) return { ok: false, reason: "Timestamp field must be a JSON field name." };
    if (displayRegex.trim()) {
      try { new RegExp(displayRegex.trim()); } catch { return { ok: false, reason: "Display regex is not valid JS regex syntax." }; }
    }
    return {
      ok: true,
      payload: {
        group_field: groupField.trim(),
        group_label: groupLabel.trim(),
        timestamp_field: timestampField.trim() || null,
        display_regex: displayRegex.trim() || null,
      },
    };
  }

  async function handleSave() {
    const v = validate();
    if (!v.ok) { setValidation(v.reason); return; }
    setValidation(null);
    await onSave(v.payload);
  }

  return (
    <div style={{
      padding: "12px 12px 10px",
      borderRadius: 8,
      border: "0.5px solid var(--line-thin)",
      background: "var(--bg-surface)",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13, color: "var(--ink-primary)" }}>Edit {row.kind}</strong>
        <button onClick={onCancel} disabled={busy} style={{ all: "unset", cursor: busy ? "default" : "pointer", fontSize: 12, color: "var(--ink-tertiary)" }}>
          Cancel
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Group field" hint="payload key, e.g. from_email">
          <input value={groupField} onChange={(e) => setGroupField(e.target.value)} disabled={busy} style={inputStyle} />
        </Field>
        <Field label="Group label" hint="header shown above the leaves">
          <input value={groupLabel} onChange={(e) => setGroupLabel(e.target.value)} disabled={busy} style={inputStyle} />
        </Field>
        <Field label="Timestamp field" hint="optional — used to sort groups by recency">
          <input value={timestampField} onChange={(e) => setTimestampField(e.target.value)} disabled={busy} style={inputStyle} placeholder="date" />
        </Field>
        <Field label="Display regex" hint="optional — one capture group cleans the displayed value">
          <input value={displayRegex} onChange={(e) => setDisplayRegex(e.target.value)} disabled={busy} style={inputStyle} placeholder="<\\s*([^>]+)\\s*>" />
        </Field>
      </div>
      {validation && (
        <div style={{ fontSize: 12, color: "#b91c1c" }}>{validation}</div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{ ...btnStyle, color: "var(--ink-secondary)", background: "transparent", border: "0.5px solid var(--line-strong)" }}
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={busy}
          style={{ ...btnStyle, color: "white", background: "var(--accent)" }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-secondary)" }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 10, color: "var(--ink-tertiary)" }}>{hint}</span>}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "6px 8px",
  borderRadius: 4,
  border: "0.5px solid var(--line-strong)",
  background: "var(--bg-surface)",
  fontFamily: "var(--font-mono, monospace)",
};

const btnStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  borderRadius: 6,
  cursor: "pointer",
  border: "none",
};
