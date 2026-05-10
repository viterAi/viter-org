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
  onRetryAi: () => void;
  onMarkFollowedUp: (invoiceId: string) => void;
  onAgentAction: (message?: string) => void;
}

export function CanvasContent({
  loading, mounted, sourceId, generating, canvasError,
  aiStatus, aiPages, aiPageStatuses, activeAiPageId, progressLog,
  activeView, rows, activeColumns, rowKey, busy, pendingDraft,
  isRefreshingContent, refreshingComponentIds,
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
      {mounted && !loading && !sourceId ? (
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
