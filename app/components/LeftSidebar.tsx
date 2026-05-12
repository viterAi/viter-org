"use client";

import { useMemo } from "react";
import type { Source } from "../types";
import { SourceIcon } from "./SourceIcon";
import { CHANNEL_DOMAINS, channelLabel } from "../utils";

const LIVE_CHANNELS = new Set([
  "whatsapp", "email", "slack",
  "gmail", "outlook", "telegram", "facebook_messenger", "facebook",
  "instagram", "linkedin", "twitter_x", "monday_com", "notion", "airtable",
  "google_sheets", "excel", "hubspot", "salesforce", "zendesk", "intercom",
  "onedrive", "google_drive", "dropbox", "sharepoint",
]);

type Props = {
  sources: Source[];
  sourceId: string;
  setSourceId: (id: string) => void;
  expandedChannels: Set<string>;
  setExpandedChannels: React.Dispatch<React.SetStateAction<Set<string>>>;
  width: number;
  cornJobsActive: boolean;
  onCornJobs: () => void;
};

export function LeftSidebar({
  sources, sourceId, setSourceId,
  expandedChannels, setExpandedChannels, width,
  cornJobsActive, onCornJobs,
}: Props) {
  const channelGroups = useMemo(() => {
    const map = new Map<string, Source[]>();
    for (const s of sources) {
      const ch = s.channel ?? "manual_upload";
      if (!map.has(ch)) map.set(ch, []);
      map.get(ch)!.push(s);
    }
    // Live channels first, then the rest
    return Array.from(map.entries()).sort(([a], [b]) => {
      const aLive = LIVE_CHANNELS.has(a) ? 0 : 1;
      const bLive = LIVE_CHANNELS.has(b) ? 0 : 1;
      return aLive - bLive || a.localeCompare(b);
    });
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
    <aside style={{
      width,
      flexShrink: 0,
      background: "var(--bg-surface)",
      borderRadius: "var(--r-zone)",
      boxShadow: "inset 0 0 0 0.5px var(--line-thin)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "11px 14px 10px",
        borderBottom: "0.5px solid var(--line-thin)",
        fontSize: 11,
        fontWeight: 600,
        color: "var(--ink-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        flexShrink: 0,
      }}>
        Sources
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 8px" }}>
        {channelGroups.map(([channel, channelSources]) => {
          const isExpanded = expandedChannels.has(channel);
          const hasActive = channelSources.some((s) => s.id === sourceId);
          const isLive = LIVE_CHANNELS.has(channel);

          return (
            <div key={channel}>
              <button
                onClick={() => isLive && toggleChannel(channel)}
                className={isLive ? "btn-ghost" : undefined}
                style={{
                  all: "unset",
                  cursor: isLive ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "5px 12px",
                  boxSizing: "border-box",
                  borderRadius: 4,
                  opacity: isLive ? 1 : 0.4,
                }}
              >
                <span style={{
                  fontSize: 9, color: "var(--ink-tertiary)",
                  display: "inline-block",
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s",
                  visibility: isLive ? "visible" : "hidden",
                }}>▶</span>
                <SourceIcon name={channelLabel(channel)} keyStr={channel} domain={CHANNEL_DOMAINS[channel]} />
                <span style={{
                  flex: 1, fontSize: 12, fontWeight: 500,
                  color: hasActive ? "var(--accent)" : "var(--ink-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {channelLabel(channel)}
                </span>
                {!isLive && (
                  <span style={{ fontSize: 9, color: "var(--ink-quaternary, var(--ink-tertiary))", letterSpacing: "0.03em" }}>soon</span>
                )}
                {isLive && (
                  <span style={{ fontSize: 10, color: "var(--ink-tertiary)", background: "var(--bg-secondary)", borderRadius: 8, padding: "1px 5px" }}>
                    {channelSources.length}
                  </span>
                )}
              </button>

              {isExpanded && isLive && (
                <div style={{ paddingBottom: 4 }}>
                  {channelSources.map((s) => {
                    const active = s.id === sourceId;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSourceId(s.id)}
                        className={active ? undefined : "btn-ghost"}
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          display: "block",
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "5px 12px 5px 28px",
                          borderRadius: 4,
                          background: active ? "var(--accent-tint)" : "transparent",
                        }}
                      >
                        <div style={{
                          fontSize: 12, fontWeight: active ? 500 : 400,
                          color: active ? "var(--accent)" : "var(--ink-primary)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {s.name}
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

      <div style={{
        flexShrink: 0,
        borderTop: "0.5px solid var(--line-thin)",
        padding: "8px 10px 10px",
      }}>
        <button
          type="button"
          onClick={onCornJobs}
          className={cornJobsActive ? undefined : "btn-ghost"}
          style={{
            all: "unset",
            cursor: "pointer",
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: cornJobsActive ? 500 : 400,
            color: cornJobsActive ? "var(--accent)" : "var(--ink-primary)",
            background: cornJobsActive ? "var(--accent-tint)" : "transparent",
            textAlign: "center",
          }}
        >
          Corn jobs
        </button>
      </div>
    </aside>
  );
}
