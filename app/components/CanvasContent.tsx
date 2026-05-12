"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { View, Row, UiColumn, AiPage, AiPageStatus, AiStatus, ProgressStep, Draft } from "../types";
import { AiComponentRenderer } from "./AiComponentRenderer";
import { AnimatedTile } from "./AnimatedTile";
import { GenerationProgress } from "./GenerationProgress";
import { AiStatusPanel } from "./AiStatusPanel";
import { LegacyViewRenderer } from "./LegacyViewRenderer";

interface CanvasContentProps {
  loading: boolean;
  mounted: boolean;
  sourceId: string;
  generating: boolean;
  /** True while loadOrGenerate is running — suppresses the "no synthesis" empty state during the async window. */
  loadingCanvas: boolean;
  canvasError: string;
  aiStatus: AiStatus;
  aiPages: AiPage[];
  aiPageStatuses: AiPageStatus[];
  activeAiPageId: string;
  progressLog: ProgressStep[];
  activeView: View | null;
  rows: Row[];
  activeColumns: UiColumn[];
  rowKey: string;
  busy: string;
  pendingDraft: Draft | null;
  isRefreshingContent: boolean;
  refreshingComponentIds: Set<string>;
  /** True when the user has zero `genui_channels` rows visible — sidebar is empty. */
  noSourcesAvailable: boolean;
  /** Open the Corn jobs page so the user can connect a service. */
  onOpenCornJobs: () => void;
  onRetryAi: () => void;
  onMarkFollowedUp: (invoiceId: string) => void;
  onAgentAction: (message?: string) => void;
}

export function CanvasContent({
  loading, mounted, sourceId, generating, loadingCanvas, canvasError,
  aiStatus, aiPages, aiPageStatuses, activeAiPageId, progressLog,
  activeView, rows, activeColumns, rowKey, busy, pendingDraft,
  isRefreshingContent, refreshingComponentIds,
  noSourcesAvailable, onOpenCornJobs,
  onRetryAi, onMarkFollowedUp, onAgentAction,
}: CanvasContentProps) {
  const showAiOnly = aiStatus.state === "invalid" || aiStatus.state === "plan_failed";
  const activeAiPageStatus = aiPageStatuses.find((s) => s.page_id === activeAiPageId) ?? null;
  const activeAiPage = aiPages.find((p) => p.id === activeAiPageId) ?? aiPages[0] ?? null;

  void pendingDraft;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: 20 }}>
      {mounted && loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-tertiary)", fontSize: 12 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, animation: "pulse-dot 1.4s ease-in-out infinite", display: "inline-block" }} />
          Loading sources…
        </div>
      ) : null}
      {mounted && !loading && !sourceId && noSourcesAvailable ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, userSelect: "none", padding: 20 }}>
          <svg width="40" height="40" viewBox="0 0 32 32" fill="none" opacity={0.3}>
            <rect x="4" y="4" width="10" height="10" rx="2.5" fill="currentColor"/>
            <rect x="18" y="4" width="10" height="10" rx="2.5" fill="currentColor"/>
            <rect x="4" y="18" width="10" height="10" rx="2.5" fill="currentColor"/>
            <rect x="18" y="18" width="10" height="10" rx="2.5" fill="currentColor"/>
          </svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-primary)", textAlign: "center" }}>No sources connected yet</div>
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)", textAlign: "center", maxWidth: 360, lineHeight: 1.5 }}>
            Connect Gmail, GitHub, or Outlook in <strong>Corn jobs</strong> to start ingesting events. Each connection becomes a source you can synthesize from.
          </div>
          <button
            type="button"
            onClick={onOpenCornJobs}
            style={{
              padding: "9px 18px",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: "var(--r-card)",
              border: "none",
              cursor: "pointer",
              background: "var(--good)",
              color: "#fff",
            }}
          >
            Open Corn jobs
          </button>
        </div>
      ) : null}

      {mounted && !loading && !sourceId && !noSourcesAvailable ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, userSelect: "none" }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity={0.25}>
            <rect x="4" y="4" width="10" height="10" rx="2.5" fill="currentColor"/>
            <rect x="18" y="4" width="10" height="10" rx="2.5" fill="currentColor"/>
            <rect x="4" y="18" width="10" height="10" rx="2.5" fill="currentColor"/>
            <rect x="18" y="18" width="10" height="10" rx="2.5" fill="currentColor"/>
          </svg>
          <span style={{ fontSize: 12, color: "var(--ink-tertiary)", textAlign: "center" }}>Pick a source from the left rail to build your canvas.</span>
        </div>
      ) : null}

      {mounted && !loading && !loadingCanvas && sourceId && !generating && !canvasError && aiPages.length === 0 && aiStatus.state === "ready" ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, userSelect: "none", padding: 20 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" opacity={0.3}>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M12 8v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-primary)", textAlign: "center" }}>No synthesis yet for this channel</div>
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)", textAlign: "center", maxWidth: 360, lineHeight: 1.5 }}>
            This channel exists but no L2 rows have been ingested in the last 30 days. New events will appear here as your background workers process them.
          </div>
          <button
            type="button"
            onClick={onRetryAi}
            style={{
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 500,
              borderRadius: "var(--r-card)",
              border: "0.5px solid var(--line-strong)",
              cursor: "pointer",
              background: "transparent",
              color: "var(--ink-primary)",
            }}
          >
            Check again
          </button>
        </div>
      ) : null}

      {canvasError ? (
        <div style={{ padding: 12, borderRadius: 6, background: "var(--danger-tint)", color: "var(--ink-secondary)", fontSize: 12 }}>
          {canvasError}
        </div>
      ) : null}

      {showAiOnly ? (
        <AiStatusPanel aiStatus={aiStatus} aiPageStatuses={aiPageStatuses} onRetry={onRetryAi} />
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
              {activeAiPage.components.map((component, index) => (
                <AnimatedTile key={`${component.component_id}-${index}`} delay={index * 0.055}>
                  <AiComponentRenderer
                    component={component}
                    index={index}
                    rows={rows}
                    activeColumns={activeColumns}
                    attentionRows={rows.slice(0, 5)}
                    isRefreshing={
                      isRefreshingContent &&
                      (component.mode === "dynamic" || refreshingComponentIds.has(component.component_id))
                    }
                    onAgentAction={onAgentAction}
                  />
                </AnimatedTile>
              ))}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!showAiOnly && !generating && !activeAiPage && activeView ? (
        <LegacyViewRenderer
          view={activeView}
          rows={rows}
          activeColumns={activeColumns}
          rowKey={rowKey}
          busy={busy}
          onMarkFollowedUp={onMarkFollowedUp}
        />
      ) : null}
    </div>
  );
}
