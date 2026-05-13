"use client";

import { GenUIIngestJobsPanel } from "./GenUIIngestJobsPanel";
import { GenuiKindGroupingPanel } from "./GenuiKindGroupingPanel";

/** Main column when “Corn jobs” is active — scheduled / webhook ingest surfaces. */
export function CornJobsCanvas({ onSourcesChanged }: { onSourcesChanged?: () => void }) {
  return (
    <div style={{
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      <header style={{
        flexShrink: 0,
        borderBottom: "0.5px solid var(--line-thin)",
        padding: "18px 24px 16px",
      }}>
        <h1 style={{
          margin: 0,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: "-0.03em",
          lineHeight: 1.15,
          color: "var(--ink-primary)",
        }}>
          Corn jobs
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink-secondary)", maxWidth: 560 }}>
          Connect GitHub repos, Gmail, or Outlook — events are synthesized automatically.
        </p>
      </header>
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        overflowX: "hidden",
        padding: 20,
      }}>
        <GenUIIngestJobsPanel onSourcesChanged={onSourcesChanged} />
        <GenuiKindGroupingPanel />
      </div>
    </div>
  );
}
