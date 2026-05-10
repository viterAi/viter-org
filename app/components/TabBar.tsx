"use client";

import type { AiPage, AiPageStatus, View, Draft } from "../types";

type Props = {
  aiPages: AiPage[];
  activeAiPageId: string;
  setActiveAiPageId: (id: string) => void;
  aiPageStatuses: AiPageStatus[];
  views: View[];
  activeViewId: string;
  setActiveViewId: (id: string) => void;
  pendingDraft: Draft | null;
  activeView: View | null;
  applyDraft: () => void;
  busy: string;
  sourceName: string;
  generating: boolean;
  isSaved: boolean;
  isSavingLayout: boolean;
  isRefreshingContent: boolean;
  saveError: string;
  /** True when the active page contains at least one dynamic component. */
  hasDynamic: boolean;
  onSaveLayout: () => void;
  onRegenerate: () => void;
  /** Fire a data_change trigger — refreshes dynamic components without rebuilding the layout. */
  onRefreshData: () => void;
};

export function TabBar({
  aiPages, activeAiPageId, setActiveAiPageId, aiPageStatuses,
  views, activeViewId, setActiveViewId,
  pendingDraft, activeView, applyDraft, busy, sourceName,
  generating, isSaved, isSavingLayout, isRefreshingContent, saveError, hasDynamic,
  onSaveLayout, onRegenerate, onRefreshData,
}: Props) {
  // Only show save/regenerate after generation fully completes
  const pagesReady = !generating && aiPages.length > 0;

  return (
    <div style={{ borderBottom: "0.5px solid var(--line-thin)" }}>
      <div style={{ padding: "18px 24px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 19, fontWeight: 500, flex: 1 }}>{sourceName}</div>

        {isRefreshingContent && !generating && (
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", animation: "pulse-dot 1.4s ease-in-out infinite" }} />
            Refreshing…
          </div>
        )}

        {pagesReady && isSaved && !isRefreshingContent && (
          <div style={{ fontSize: 11, color: "var(--ink-tertiary)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, color: "var(--good)" }}>✓</span>
            <span>Saved</span>
          </div>
        )}

        {pagesReady && !isSaved && (
          <button
            onClick={onSaveLayout}
            disabled={isSavingLayout}
            title={saveError || undefined}
            style={{ all: "unset", cursor: "pointer", fontSize: 11, padding: "5px 11px", borderRadius: 5, background: saveError ? "var(--warn)" : "var(--accent)", color: "#fff", fontWeight: 600, opacity: isSavingLayout ? 0.6 : 1 }}
          >
            {isSavingLayout ? "Saving…" : saveError ? "Retry save" : "Save layout"}
          </button>
        )}

        {pagesReady && isSaved && hasDynamic && !isRefreshingContent && (
          <button
            onClick={onRefreshData}
            disabled={!!busy}
            title="Re-fetch content for dynamic components (data_change trigger)"
            style={{
              all: "unset", cursor: "pointer",
              fontSize: 11, padding: "5px 11px", borderRadius: 5,
              boxShadow: "inset 0 0 0 1px var(--line-strong)",
              color: "var(--ink-secondary)", fontWeight: 500,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M8.5 5A3.5 3.5 0 1 1 5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <path d="M5 1.5L6.5 3 5 1.5 3.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Refresh data
          </button>
        )}

        {pagesReady && isSaved && (
          <button
            onClick={onRegenerate}
            disabled={!!busy}
            style={{ all: "unset", cursor: "pointer", fontSize: 11, padding: "5px 11px", borderRadius: 5, boxShadow: "inset 0 0 0 1px var(--line-strong)", color: "var(--ink-secondary)", fontWeight: 500 }}
          >
            Regenerate
          </button>
        )}

        {pagesReady && (
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "var(--accent-tint)", borderRadius: 20, padding: "2px 8px", letterSpacing: "0.02em" }}>
            {aiPages.length} {aiPages.length === 1 ? "page" : "pages"}
          </div>
        )}
      </div>

      {(aiPages.length > 0 || views.length > 0) && (
        <div style={{ display: "flex", overflowX: "auto", paddingLeft: 16, gap: 0 }}>
          {aiPages.map((page, i) => {
            const isActive = page.id === activeAiPageId;
            const pageStatus = aiPageStatuses.find((s) => s.page_id === page.id);
            const isFailed = pageStatus?.state === "invalid";
            return (
              <button
                key={page.id}
                onClick={() => setActiveAiPageId(page.id)}
                className={isActive ? undefined : "btn-ghost"}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "var(--ink-primary)" : "var(--ink-secondary)",
                  borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1,
                  whiteSpace: "nowrap",
                  transition: "color 0.15s, border-color 0.15s",
                  flexShrink: 0,
                }}
              >
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 17, height: 17, borderRadius: "50%",
                  background: isActive ? "var(--accent)" : "var(--bg-secondary)",
                  color: isActive ? "#fff" : "var(--ink-tertiary)",
                  fontSize: 9, fontWeight: 700, flexShrink: 0,
                  boxShadow: isActive ? "none" : "inset 0 0 0 1px var(--line-thin)",
                }}>
                  {i + 1}
                </span>
                {page.title}
                {isFailed && <span style={{ fontSize: 10, color: "var(--warn)", flexShrink: 0 }}>!</span>}
              </button>
            );
          })}

          {views.map((v) => {
            const isActive = v.id === activeViewId;
            return (
              <button
                key={v.id}
                onClick={() => setActiveViewId(v.id)}
                className={isActive ? undefined : "btn-ghost"}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "var(--ink-primary)" : "var(--ink-secondary)",
                  borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1,
                  whiteSpace: "nowrap",
                  transition: "color 0.15s, border-color 0.15s",
                  flexShrink: 0,
                }}
              >
                {v.view_name}
              </button>
            );
          })}
        </div>
      )}

      {pendingDraft && activeView ? (
        <div style={{ margin: "0 16px 12px", padding: "8px 10px", borderRadius: 6, background: "var(--warn-tint)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 11, color: "var(--ink-secondary)" }}>
            New source data detected. A layout draft is ready.
          </div>
          <button
            onClick={applyDraft}
            className="btn-solid"
            style={{ all: "unset", cursor: "pointer", fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "var(--ink-primary)", color: "white" }}
          >
            Apply draft
          </button>
        </div>
      ) : null}
    </div>
  );
}
