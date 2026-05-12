"use client";

import { useMemo } from "react";
import type { Source, SourceGroup, SourceTreeNode } from "../types";
import { SourceIcon } from "./SourceIcon";
import { CHANNEL_DOMAINS, channelLabel } from "../utils";

const LIVE_CHANNELS = new Set([
  "whatsapp", "email", "slack",
  "gmail", "outlook", "telegram", "facebook_messenger", "facebook",
  "instagram", "linkedin", "twitter_x", "monday_com", "notion", "airtable",
  "google_sheets", "excel", "hubspot", "salesforce", "zendesk", "intercom",
  "onedrive", "google_drive", "dropbox", "sharepoint",
  "github", "clickup",
]);

type Props = {
  sources: Source[];
  tree: SourceTreeNode[];
  sourceId: string;
  setSourceId: (id: string) => void;
  expandedChannels: Set<string>;
  setExpandedChannels: React.Dispatch<React.SetStateAction<Set<string>>>;
  width: number;
  cornJobsActive: boolean;
  onCornJobs: () => void;
};

type SidebarKindNode = {
  kind: string;
  isLive: boolean;
  leaves: SidebarLeaf[];
  /** From the grouping row — shown as a small caption next to the kind. */
  groupingLabel: string | null;
};

type SidebarLeaf = {
  id: string;
  name: string;
  /**
   * Optional tail metadata rendered to the right of the leaf label. Used by
   * group leaves to show message_count + last activity.
   */
  countLabel: string | null;
  isOther: boolean;
};

function buildKindNodes(tree: SourceTreeNode[], fallback: Source[]): SidebarKindNode[] {
  if (tree.length > 0) {
    return tree.map((node) => ({
      kind: node.kind,
      isLive: LIVE_CHANNELS.has(node.kind),
      groupingLabel: node.grouping?.group_label ?? null,
      leaves:
        node.groups.length > 0
          ? node.groups.map((g) => groupToLeaf(g))
          : node.channels.map((c) => channelToLeaf(c)),
    }));
  }
  // Pre-tree fallback (initial page load before /api/sources has resolved).
  const byKind = new Map<string, Source[]>();
  for (const s of fallback) {
    const k = s.channel ?? "manual_upload";
    const list = byKind.get(k) ?? [];
    list.push(s);
    byKind.set(k, list);
  }
  return Array.from(byKind.entries()).map(([kind, channels]) => ({
    kind,
    isLive: LIVE_CHANNELS.has(kind),
    groupingLabel: null,
    leaves: channels.map((c) => channelToLeaf(c)),
  }));
}

function groupToLeaf(g: SourceGroup): SidebarLeaf {
  const countLabel = g.message_count > 0 ? `${g.message_count}` : null;
  return { id: g.id, name: g.name, countLabel, isOther: !!g.is_other };
}

function channelToLeaf(c: Source): SidebarLeaf {
  return { id: c.id, name: c.name, countLabel: null, isOther: false };
}

export function LeftSidebar({
  sources, tree, sourceId, setSourceId,
  expandedChannels, setExpandedChannels, width,
  cornJobsActive, onCornJobs,
}: Props) {
  const kindNodes = useMemo(() => {
    const nodes = buildKindNodes(tree, sources);
    return nodes.sort((a, b) => {
      const aLive = a.isLive ? 0 : 1;
      const bLive = b.isLive ? 0 : 1;
      return aLive - bLive || a.kind.localeCompare(b.kind);
    });
  }, [tree, sources]);

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
        {kindNodes.length === 0 ? (
          <div style={{ padding: "16px 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-primary)", lineHeight: 1.4 }}>
              No sources connected
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-tertiary)", lineHeight: 1.5 }}>
              Connect a service in Corn jobs to start. Each connection becomes a source in this list.
            </div>
            <button
              type="button"
              onClick={onCornJobs}
              style={{
                marginTop: 4,
                padding: "7px 10px",
                fontSize: 12,
                fontWeight: 500,
                borderRadius: 6,
                border: "0.5px solid var(--line-strong)",
                cursor: "pointer",
                background: "transparent",
                color: "var(--ink-primary)",
                textAlign: "center",
              }}
            >
              Open Corn jobs
            </button>
          </div>
        ) : null}

        {kindNodes.map((node) => {
          const isExpanded = expandedChannels.has(node.kind);
          const hasActive = node.leaves.some((l) => l.id === sourceId);

          return (
            <div key={node.kind}>
              <button
                onClick={() => node.isLive && toggleChannel(node.kind)}
                className={node.isLive ? "btn-ghost" : undefined}
                style={{
                  all: "unset",
                  cursor: node.isLive ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "5px 12px",
                  boxSizing: "border-box",
                  borderRadius: 4,
                  opacity: node.isLive ? 1 : 0.4,
                }}
              >
                <span style={{
                  fontSize: 9, color: "var(--ink-tertiary)",
                  display: "inline-block",
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s",
                  visibility: node.isLive ? "visible" : "hidden",
                }}>▶</span>
                <SourceIcon name={channelLabel(node.kind)} keyStr={node.kind} domain={CHANNEL_DOMAINS[node.kind]} />
                <span style={{
                  flex: 1, fontSize: 12, fontWeight: 500,
                  color: hasActive ? "var(--accent)" : "var(--ink-primary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {channelLabel(node.kind)}
                </span>
                {!node.isLive && (
                  <span style={{ fontSize: 9, color: "var(--ink-quaternary, var(--ink-tertiary))", letterSpacing: "0.03em" }}>soon</span>
                )}
                {node.isLive && (
                  <span style={{ fontSize: 10, color: "var(--ink-tertiary)", background: "var(--bg-secondary)", borderRadius: 8, padding: "1px 5px" }}>
                    {node.leaves.length}
                  </span>
                )}
              </button>

              {isExpanded && node.isLive && (
                <div style={{ paddingBottom: 4 }}>
                  {node.groupingLabel && node.leaves.length > 0 && (
                    <div style={{
                      padding: "4px 12px 2px 28px",
                      fontSize: 10,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--ink-quaternary, var(--ink-tertiary))",
                    }}>
                      {node.groupingLabel}
                    </div>
                  )}
                  {node.leaves.map((leaf) => {
                    const active = leaf.id === sourceId;
                    return (
                      <button
                        key={leaf.id}
                        onClick={() => setSourceId(leaf.id)}
                        className={active ? undefined : "btn-ghost"}
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          width: "100%",
                          boxSizing: "border-box",
                          padding: "5px 12px 5px 28px",
                          borderRadius: 4,
                          background: active ? "var(--accent-tint)" : "transparent",
                        }}
                      >
                        <div style={{
                          flex: 1,
                          fontSize: 12,
                          fontWeight: active ? 500 : 400,
                          color: active ? "var(--accent)" : (leaf.isOther ? "var(--ink-tertiary)" : "var(--ink-primary)"),
                          fontStyle: leaf.isOther ? "italic" : "normal",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {leaf.name}
                        </div>
                        {leaf.countLabel && (
                          <span style={{
                            fontSize: 10,
                            color: "var(--ink-tertiary)",
                            marginLeft: 4,
                          }}>
                            {leaf.countLabel}
                          </span>
                        )}
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
