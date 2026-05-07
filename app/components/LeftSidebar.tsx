"use client";

import { useMemo } from "react";
import type { Source, SourceChannel, SourceSeedFormat } from "../types";
import { SourceIcon } from "./SourceIcon";
import { CHANNEL_DOMAINS, channelLabel, sourcePreview } from "../utils";

type Props = {
  sources: Source[];
  sourceId: string;
  setSourceId: (id: string) => void;
  expandedChannels: Set<string>;
  setExpandedChannels: React.Dispatch<React.SetStateAction<Set<string>>>;
  createSourceOpen: boolean;
  setCreateSourceOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newSourceName: string;
  setNewSourceName: (v: string) => void;
  newSourceKey: string;
  setNewSourceKey: (v: string) => void;
  newSourceChannel: SourceChannel;
  setNewSourceChannel: (v: SourceChannel) => void;
  newSourceFormat: SourceSeedFormat;
  setNewSourceFormat: (v: SourceSeedFormat) => void;
  newSourceData: string;
  setNewSourceData: (v: string) => void;
  createSource: () => void;
  busy: string;
  mounted: boolean;
  width: number;
};

export function LeftSidebar({
  sources, sourceId, setSourceId,
  expandedChannels, setExpandedChannels,
  createSourceOpen, setCreateSourceOpen,
  newSourceName, setNewSourceName,
  newSourceKey, setNewSourceKey,
  newSourceChannel, setNewSourceChannel,
  newSourceFormat, setNewSourceFormat,
  newSourceData, setNewSourceData,
  createSource, busy, mounted, width,
}: Props) {
  const channelGroups = useMemo(() => {
    const map = new Map<string, Source[]>();
    for (const s of sources) {
      const ch = s.channel ?? "manual_upload";
      if (!map.has(ch)) map.set(ch, []);
      map.get(ch)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [sources]);

  function toggleChannel(channel: string) {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  }

  return (
    <aside
      style={{
        width,
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
                <SourceIcon name={channelLabel(channel)} keyStr={channel} domain={CHANNEL_DOMAINS[channel]} />
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

      <div style={{ marginTop: "auto", padding: 10, borderTop: "0.5px solid var(--line-thin)" }}>
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
            {[
              { value: newSourceName, setter: setNewSourceName, placeholder: "Source name" },
              { value: newSourceKey, setter: setNewSourceKey, placeholder: "source_key" },
              { value: newSourceChannel, setter: setNewSourceChannel, placeholder: "channel (e.g. gmail, slack…)" },
            ].map(({ value, setter, placeholder }) => (
              <input
                key={placeholder}
                value={value}
                onChange={(e) => setter(e.target.value)}
                placeholder={placeholder}
                style={{ border: "0.5px solid var(--line-thin)", borderRadius: 4, background: "var(--bg-surface)", color: "var(--ink-primary)", padding: "6px 8px", fontSize: 11 }}
              />
            ))}
            <select
              value={newSourceFormat}
              onChange={(e) => setNewSourceFormat(e.target.value as SourceSeedFormat)}
              style={{ border: "0.5px solid var(--line-thin)", borderRadius: 4, background: "var(--bg-surface)", color: "var(--ink-primary)", padding: "6px 8px", fontSize: 11 }}
            >
              <option value="markdown">markdown</option>
              <option value="json">json</option>
              <option value="csv">csv</option>
            </select>
            <textarea
              value={newSourceData}
              onChange={(e) => setNewSourceData(e.target.value)}
              placeholder="Paste source payload (markdown/json/csv)"
              rows={5}
              style={{ border: "0.5px solid var(--line-thin)", borderRadius: 4, background: "var(--bg-surface)", color: "var(--ink-primary)", padding: "6px 8px", fontSize: 11, resize: "vertical" }}
            />
            <button
              onClick={createSource}
              className="btn-solid"
              style={{ all: "unset", cursor: "pointer", fontSize: 11, padding: "6px 8px", borderRadius: 4, background: "var(--ink-primary)", color: "white", textAlign: "center" }}
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
  );
}
