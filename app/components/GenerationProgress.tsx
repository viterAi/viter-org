"use client";

import type { ProgressStep } from "../types";

type Props = {
  progressLog: ProgressStep[];
};

export function GenerationProgress({ progressLog }: Props) {
  return (
    <div style={{ background: "var(--bg-secondary)", borderRadius: "var(--r-card)", padding: "16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>AI is designing your pages…</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {progressLog.map((step, i) => {
          if (step.type === "planning") return (
            <div key={i} style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>⬡ Planning pages from source data…</div>
          );
          if (step.type === "plan_ready") return (
            <div key={i} style={{ fontSize: 11, color: "var(--ink-secondary)" }}>✓ Page plan ready — {step.pages.length} page{step.pages.length !== 1 ? "s" : ""}: {step.pages.map((p) => p.title).join(", ")}</div>
          );
          if (step.type === "page_start") return (
            <div key={i} style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>⬡ Filling <b>{step.title}</b>…</div>
          );
          if (step.type === "page_attempt" && step.attempt > 1) return (
            <div key={i} style={{ fontSize: 11, color: "var(--ink-tertiary)" }}>↺ <b>{step.page_id}</b> attempt {step.attempt}/{step.max_attempts}{step.last_error ? ` — ${step.last_error}` : ""}</div>
          );
          if (step.type === "page_done") return (
            <div key={i} style={{ fontSize: 11, color: "var(--ink-secondary)" }}>✓ <b>{step.title}</b> ready ({step.attempts_used} attempt{step.attempts_used !== 1 ? "s" : ""})</div>
          );
          if (step.type === "page_failed") return (
            <div key={i} style={{ fontSize: 11, color: "var(--ink-secondary)" }}>✗ <b>{step.page_id}</b> failed after {step.attempts_used} attempts</div>
          );
          return null;
        })}
      </div>
    </div>
  );
}
