"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ConnectServiceModal } from "./ConnectServiceModal";

type Channel = {
  id: string;
  source: string;
  external_key: string;
  display_name: string | null;
  agent_prompt: string;
  created_at: string;
};

const SOURCE_META: Record<string, { label: string; icon: string; color: string }> = {
  github:  { label: "GitHub",  icon: "GH", color: "#24292e" },
  gmail:   { label: "Gmail",   icon: "GM", color: "#ea4335" },
  outlook: { label: "Outlook", icon: "OL", color: "#0078d4" },
};

function sourceMeta(source: string) {
  return SOURCE_META[source] ?? { label: source, icon: source.slice(0, 2).toUpperCase(), color: "var(--ink-tertiary)" };
}

function MenuDots({
  onRemove,
  busy,
}: {
  onRemove: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: "2px 8px",
          fontSize: 18,
          lineHeight: 1,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--ink-tertiary)",
          borderRadius: 4,
        }}
      >
        ···
      </button>
      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 10 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              background: "var(--bg-surface)",
              border: "0.5px solid var(--line-strong)",
              borderRadius: "var(--r-card)",
              boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
              minWidth: 140,
              zIndex: 20,
              overflow: "hidden",
            }}
          >
            <button
              disabled={busy}
              onClick={() => { setOpen(false); onRemove(); }}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 14px",
                textAlign: "left",
                fontSize: 13,
                background: "transparent",
                border: "none",
                cursor: busy ? "not-allowed" : "pointer",
                color: "var(--danger)",
                opacity: busy ? 0.5 : 1,
              }}
            >
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function GenUIIngestJobsPanel({ onSourcesChanged }: { onSourcesChanged?: () => void }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [c1, c2] = await Promise.all([
        fetch("/api/genui/config", { credentials: "include" }),
        fetch("/api/genui/channels", { credentials: "include" }),
      ]);
      if (!c1.ok) {
        const j = await c1.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? c1.statusText);
      }
      if (!c2.ok) {
        const j = await c2.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error ?? c2.statusText);
      }
      await c1.json(); // config — unused in card UI but validates tenant
      const ch = await c2.json() as { channels: Channel[] };
      setChannels(ch.channels ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(channelId: string) {
    if (!confirm("Remove this connection?")) return;
    setBusy(true);
    try {
      await fetch(`/api/genui/channels/${channelId}`, { method: "DELETE", credentials: "include" });
      await load();
      onSourcesChanged?.();
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    const isNoTenant = loadError.includes("no_tenant");
    return (
      <div style={{ fontSize: 13, color: "var(--danger)", lineHeight: 1.6 }}>
        <p style={{ margin: "0 0 8px" }}>{loadError}</p>
        {isNoTenant ? (
          <div style={{ color: "var(--ink-secondary)", fontSize: 12 }}>
            <p style={{ margin: "0 0 8px" }}>
              Your account is signed in, but no <strong>tenant</strong> was found. Pick one path:
            </p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>Production:</strong> add your <code>auth.users.id</code> to{" "}
                <code>tenant_memberships</code> or <code>tenant_members</code> for the right{" "}
                <code>tenant_id</code>.
              </li>
              <li>
                <strong>Local dev:</strong> <code>next dev</code> sets <code>NODE_ENV=development</code>. Ensure a{" "}
                <code>tenants</code> row with slug <code>viter</code> exists, or set{" "}
                <code>L0_DEV_TENANT_ID=&lt;uuid&gt;</code> in <code>.env</code>.
              </li>
              <li>
                <strong>Single-tenant / staging:</strong> set{" "}
                <code>L0_ALLOW_TENANT_SLUG_FALLBACK=1</code> and{" "}
                <code>L0_DEFAULT_TENANT_SLUG=your-slug</code>.
              </li>
            </ul>
          </div>
        ) : (
          <span style={{ color: "var(--ink-tertiary)" }}>
            Ensure L0 migrations include <code>genui_*</code> tables and your Supabase env keys are set.
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-tertiary)" }}>
          {channels.length === 0 ? "No sources connected yet." : `${channels.length} source${channels.length !== 1 ? "s" : ""} connected`}
        </p>
        <button
          onClick={() => setShowModal(true)}
          style={{
            padding: "9px 16px",
            fontSize: 13,
            fontWeight: 600,
            borderRadius: "var(--r-card)",
            border: "none",
            cursor: "pointer",
            background: "var(--good)",
            color: "#fff",
          }}
        >
          + Connect service
        </button>
      </div>

      {/* Card grid */}
      {channels.length === 0 ? (
        <div
          style={{
            borderRadius: "var(--r-zone)",
            border: "0.5px dashed var(--line-strong)",
            padding: "40px 24px",
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink-tertiary)" }}>
            Connect GitHub, Gmail, or Outlook to start ingesting events.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {channels.map((c) => {
            const meta = sourceMeta(c.source);
            const name = c.display_name ?? c.external_key;
            return (
              <div
                key={c.id}
                style={{
                  borderRadius: "var(--r-card)",
                  border: "0.5px solid var(--line-thin)",
                  background: "var(--bg-surface)",
                  padding: "14px 14px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 7,
                        background: meta.color + "18",
                        border: `0.5px solid ${meta.color}30`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 700,
                        color: meta.color,
                        flexShrink: 0,
                      }}
                    >
                      {meta.icon}
                    </span>
                    <span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          color: "var(--ink-tertiary)",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {meta.label}
                      </span>
                    </span>
                  </div>
                  <MenuDots onRemove={() => void onDelete(c.id)} busy={busy} />
                </div>

                <div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink-primary)",
                      fontFamily: c.source === "github" ? "ui-monospace, monospace" : undefined,
                      wordBreak: "break-all",
                    }}
                  >
                    {name}
                  </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--good)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>Live</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <ConnectServiceModal
          onClose={() => setShowModal(false)}
          onConnected={() => {
            void load();
            onSourcesChanged?.();
          }}
        />
      )}
    </>
  );
}
