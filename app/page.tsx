"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { UiColumn } from "./types";
import { Murmur } from "./components/Murmur";
import { LeftSidebar } from "./components/LeftSidebar";
import { TabBar } from "./components/TabBar";
import { Dock } from "./components/Dock";
import { CanvasContent } from "./components/CanvasContent";
import { CornJobsCanvas } from "./components/CornJobsCanvas";
import { useUser } from "@/lib/auth/UserContext";
import { useResizablePanels } from "./hooks/useResizablePanels";
import { useSources } from "./hooks/useSources";
import { useCanvas } from "./hooks/useCanvas";

const dragPip: React.CSSProperties = {
  width: 2, height: 32, borderRadius: 1,
  background: "var(--line-thin)", opacity: 0.6,
};

export default function HomePage() {
  const { user, loading: authLoading } = useUser();
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [cornJobsPage, setCornJobsPage] = useState(false);

  const panels = useResizablePanels();
  const src = useSources();
  const canvas = useCanvas({ sourceId: src.sourceId, sources: src.sources, setSourceId: src.setSourceId, setBusy: src.setBusy });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Refetch sidebar + channel selection whenever the signed-in user changes (not only on first mount).
  useEffect(() => {
    if (authLoading || !user?.id) return;
    setLoading(true);
    src.fetchSources().finally(() => setLoading(false));
  }, [authLoading, user?.id, src.fetchSources]);

  useEffect(() => {
    if (src.sourceId) void canvas.loadOrGenerate(src.sourceId);
  }, [src.sourceId]);

  const activeView = useMemo(() => canvas.views.find((v) => v.id === canvas.activeViewId) ?? null, [canvas.views, canvas.activeViewId]);
  const sourceName = src.sources.find((s) => s.id === src.sourceId)?.name ?? "";
  const activePageTitle = canvas.aiPages.find((p) => p.id === canvas.activeAiPageId)?.title ?? "";

  // True when the active page has at least one dynamic component — used to show the Refresh button.
  const hasDynamic = useMemo(() => {
    const activePage = canvas.aiPages.find((p) => p.id === canvas.activeAiPageId) ?? canvas.aiPages[0];
    return activePage?.components.some((c) => c.mode === "dynamic") ?? false;
  }, [canvas.aiPages, canvas.activeAiPageId]);

  const activeColumns: UiColumn[] = (() => {
    const columns = activeView?.spec?.layout?.columns;
    if (Array.isArray(columns) && columns.length > 0) {
      const first = columns[0];
      if (typeof first === "string") return (columns as string[]).map((field) => ({ id: field, field, label: field, kind: "string" as const }));
      return columns as UiColumn[];
    }
    return Object.keys(canvas.rows[0] ?? {}).map((field) => ({ id: field, field, label: field, kind: "string" as const }));
  })();

  const rowKey = activeView?.spec?.layout?.row_key ?? (canvas.rows[0]?.invoice_id ? "invoice_id" : "id");

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", gap: 6, padding: 8 }}>
      {/* Murmur — ambient top bar */}
      <Murmur
        sourceName={sourceName}
        pageTitle={activePageTitle}
        generating={canvas.generating}
        isRefreshingContent={canvas.isRefreshingContent}
        isSaved={canvas.isSaved}
      />

      {/* Surface — sidebar + canvas */}
      <div style={{ flex: 1, display: "flex", gap: 0, minHeight: 0 }}>
        <LeftSidebar
          sources={src.sources}
          tree={src.tree}
          sourceId={src.sourceId}
          setSourceId={(id) => {
            setCornJobsPage(false);
            src.setSourceId(id);
          }}
          expandedChannels={src.expandedChannels} setExpandedChannels={src.setExpandedChannels}
          width={panels.leftWidth}
          cornJobsActive={cornJobsPage}
          onCornJobs={() => setCornJobsPage(true)}
        />

        <div
          onMouseDown={panels.startDragLeft}
          className="drag-handle"
          style={{ width: 8, flexShrink: 0, cursor: "col-resize", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}
        >
          <div className="drag-pip" style={dragPip} />
        </div>

        <main style={{
          flex: 1, minWidth: 0,
          background: "var(--bg-surface)",
          borderRadius: "var(--r-zone)",
          boxShadow: "inset 0 0 0 0.5px var(--line-thin)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}>
          {cornJobsPage ? (
            <CornJobsCanvas />
          ) : (
            <>
              <TabBar
                aiPages={canvas.aiPages} activeAiPageId={canvas.activeAiPageId} setActiveAiPageId={canvas.setActiveAiPageId}
                aiPageStatuses={canvas.aiPageStatuses} views={canvas.views} activeViewId={canvas.activeViewId}
                setActiveViewId={canvas.setActiveViewId} pendingDraft={canvas.pendingDraft} activeView={activeView}
                applyDraft={() => { if (activeView && canvas.pendingDraft) void canvas.applyDraft(activeView.id, canvas.pendingDraft); }}
                busy={src.busy} sourceName={sourceName}
                generating={canvas.generating}
                isSaved={canvas.isSaved} isSavingLayout={canvas.isSavingLayout}
                isRefreshingContent={canvas.isRefreshingContent}
                saveError={canvas.saveError}
                hasDynamic={hasDynamic}
                onSaveLayout={() => void canvas.saveLayout(src.sourceId)}
                onRegenerate={() => void canvas.regenerate(src.sourceId)}
                onRefreshData={() => canvas.refreshDynamic("data_change")}
              />
              <CanvasContent
                loading={loading} mounted={mounted} sourceId={src.sourceId}
                generating={canvas.generating} loadingCanvas={canvas.loadingCanvas}
                canvasError={canvas.canvasError}
                aiStatus={canvas.aiStatus} aiPages={canvas.aiPages} aiPageStatuses={canvas.aiPageStatuses}
                activeAiPageId={canvas.activeAiPageId} progressLog={canvas.progressLog}
                activeView={activeView} rows={canvas.rows}
                activeColumns={activeColumns} rowKey={String(rowKey)} busy={src.busy}
                pendingDraft={canvas.pendingDraft}
                isRefreshingContent={canvas.isRefreshingContent}
                refreshingComponentIds={canvas.refreshingComponentIds}
                noSourcesAvailable={!loading && src.sources.length === 0}
                onOpenCornJobs={() => setCornJobsPage(true)}
                onRetryAi={() => { if (src.sourceId) void canvas.fetchCanvas(src.sourceId); }}
                onMarkFollowedUp={() => { canvas.addOfflineMessage(); }}
                onAgentAction={(msg) => {
                  if (msg) void canvas.sendSteerMessage(msg);
                  else canvas.addOfflineMessage();
                }}
              />
            </>
          )}
        </main>
      </div>

      {/* Dock — conversational steer at bottom */}
      <Dock
        steerMessages={canvas.steerMessages}
        steerInput={canvas.steerInput} setSteerInput={canvas.setSteerInput}
        steering={canvas.steering} steerHintIdx={canvas.steerHintIdx}
        sendSteerMessage={canvas.sendSteerMessage}
        sourceId={src.sourceId} hasPages={canvas.aiPages.length > 0}
        steerScrollRef={canvas.steerScrollRef}
      />
    </div>
  );
}
