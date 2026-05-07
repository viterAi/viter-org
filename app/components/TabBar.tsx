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
};

export function TabBar({
  aiPages, activeAiPageId, setActiveAiPageId, aiPageStatuses,
  views, activeViewId, setActiveViewId,
  pendingDraft, activeView, applyDraft, busy, sourceName,
}: Props) {
  return (
    <div style={{ borderBottom: "0.5px solid var(--line-thin)" }}>
      <div style={{ padding: "18px 24px 14px", display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 19, fontWeight: 500 }}>{sourceName}</div>
        {aiPages.length > 0 && (
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
