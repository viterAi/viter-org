"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { ProgressStep } from "../types";

type Props = {
  progressLog: ProgressStep[];
};

/* ── helpers ─────────────────────────────────────────────────────────── */

type Stage = "boot" | "planning" | "building" | "done";

function deriveStage(log: ProgressStep[]): Stage {
  if (log.length === 0) return "boot";
  for (let i = log.length - 1; i >= 0; i--) {
    const s = log[i];
    if (s.type === "page_done") return "building";
    if (s.type === "page_start" || s.type === "page_attempt") return "building";
    if (s.type === "plan_ready") return "building";
    if (s.type === "planning") return "planning";
  }
  return "boot";
}

function deriveLabel(log: ProgressStep[]): string {
  if (log.length === 0) return "Starting up…";
  for (let i = log.length - 1; i >= 0; i--) {
    const s = log[i];
    if (s.type === "page_done") return `Built "${s.title}"`;
    if (s.type === "page_start") return `Building "${s.title}"…`;
    if (s.type === "page_attempt" && s.attempt > 1) return `Retrying "${s.page_id}"…`;
    if (s.type === "plan_ready") {
      const n = s.pages.length;
      return `${n} page${n !== 1 ? "s" : ""} planned`;
    }
    if (s.type === "planning") return "Reading your data…";
  }
  return "Working…";
}

function derivePlannedPages(log: ProgressStep[]): string[] {
  for (let i = log.length - 1; i >= 0; i--) {
    const s = log[i];
    if (s.type === "plan_ready") return s.pages.map((p) => p.title);
  }
  return [];
}

function deriveDonePages(log: ProgressStep[]): string[] {
  return log
    .filter((s): s is Extract<ProgressStep, { type: "page_done" }> => s.type === "page_done")
    .map((s) => s.title);
}

/* ── sub-components ───────────────────────────────────────────────────── */

const shimmer: React.CSSProperties = {
  background:
    "linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary,#efebe4) 50%, var(--bg-secondary) 100%)",
  backgroundSize: "240% 100%",
  animation: "shimmer 2s ease-in-out infinite",
};

function Skel({ h, w = "100%", r = 5, o = 1 }: { h: number; w?: string | number; r?: number; o?: number }) {
  return (
    <div
      style={{
        ...shimmer,
        height: h,
        width: w,
        borderRadius: r,
        opacity: o,
        flexShrink: 0,
      }}
    />
  );
}

function KpiCard({ delay, opacity }: { delay: number; opacity: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity, y: 0 }}
      transition={{ duration: 0.4, delay }}
      style={{ ...shimmer, borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      <Skel h={9} w="52%" r={4} o={0.6} />
      <Skel h={26} w="68%" r={5} o={0.8} />
      <Skel h={7} w="40%" r={3} o={0.4} />
    </motion.div>
  );
}

function InsightCard({ delay }: { delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      style={{ ...shimmer, borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 9 }}
    >
      <Skel h={9} w="36%" r={4} o={0.6} />
      <Skel h={7} w="95%" r={3} o={0.45} />
      <Skel h={7} w="84%" r={3} o={0.4} />
      <Skel h={7} w="72%" r={3} o={0.35} />
      <Skel h={7} w="50%" r={3} o={0.3} />
    </motion.div>
  );
}

function ChartCard({ delay }: { delay: number }) {
  const bars = [0.45, 0.72, 0.55, 0.9, 0.68, 0.38, 0.82];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      style={{ ...shimmer, borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      <Skel h={9} w="44%" r={4} o={0.6} />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 64, paddingTop: 4 }}>
        {bars.map((h, i) => (
          <motion.div
            key={i}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.5, delay: delay + i * 0.06, ease: "easeOut" }}
            style={{
              flex: 1,
              height: `${h * 100}%`,
              background: "rgba(0,0,0,0.09)",
              borderRadius: "3px 3px 0 0",
              transformOrigin: "bottom",
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function TableCard({ delay }: { delay: number }) {
  const cols = [130, 88, 96, 64, 76];
  const rows = [
    [1, 0.75, 0.82, 0.9, 0.7],
    [0.88, 0.6, 0.7, 0.8, 0.5],
    [0.95, 0.8, 0.65, 0.55, 0.85],
    [0.7, 0.9, 0.78, 0.6, 0.72],
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      style={{ ...shimmer, borderRadius: 10, overflow: "hidden" }}
    >
      {/* header */}
      <div style={{ height: 34, display: "flex", alignItems: "center", paddingInline: 16, gap: 20, background: "rgba(0,0,0,0.04)" }}>
        {cols.map((w, i) => (
          <div key={i} style={{ height: 7, width: w, background: "rgba(0,0,0,0.1)", borderRadius: 3, flexShrink: 0 }} />
        ))}
      </div>
      {rows.map((row, ri) => (
        <div key={ri} style={{ height: 32, display: "flex", alignItems: "center", paddingInline: 16, gap: 20, borderTop: "0.5px solid rgba(0,0,0,0.04)" }}>
          {cols.map((w, ci) => (
            <div key={ci} style={{ height: 6, width: w * row[ci], background: "rgba(0,0,0,0.055)", borderRadius: 3, flexShrink: 0 }} />
          ))}
        </div>
      ))}
    </motion.div>
  );
}

/* ── stage indicators ─────────────────────────────────────────────────── */

function StageRow({ stage }: { stage: Stage }) {
  const steps: Array<{ key: Stage | "done"; label: string }> = [
    { key: "boot", label: "Connect" },
    { key: "planning", label: "Analyse" },
    { key: "building", label: "Build" },
  ];

  const order: (Stage | "done")[] = ["boot", "planning", "building"];
  const currentIdx = order.indexOf(stage);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      {steps.map(({ key, label }, i) => {
        const stepIdx = order.indexOf(key);
        const isDone = stepIdx < currentIdx;
        const isActive = stepIdx === currentIdx;
        return (
          <React.Fragment key={key}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: isDone ? "var(--good)" : isActive ? "var(--accent)" : "var(--bg-tertiary)",
                flexShrink: 0,
                transition: "background 0.3s",
              }}>
                {isDone ? (
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1.5 4l2 2 3-3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : isActive ? (
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "white", animation: "pulse-dot 1.4s ease-in-out infinite", display: "block" }} />
                ) : null}
              </div>
              <span style={{
                fontSize: 10,
                fontWeight: isActive ? 600 : 400,
                color: isDone ? "var(--good)" : isActive ? "var(--accent)" : "var(--ink-quaternary)",
                transition: "color 0.3s",
              }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                width: 24,
                height: 0.5,
                margin: "0 6px",
                background: isDone ? "var(--good)" : "var(--line-strong)",
                transition: "background 0.3s",
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ── page progress pills ──────────────────────────────────────────────── */

function PagePills({ planned, done }: { planned: string[]; done: string[] }) {
  if (planned.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {planned.map((title, i) => {
        const isDone = done.includes(title);
        return (
          <motion.div
            key={title}
            initial={{ opacity: 0, scale: 0.88 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.28, delay: i * 0.07 }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 9px",
              borderRadius: 20,
              background: isDone ? "var(--good-tint)" : "var(--bg-secondary)",
              boxShadow: `inset 0 0 0 0.5px ${isDone ? "var(--good)" : "var(--line-strong)"}`,
              transition: "background 0.35s, box-shadow 0.35s",
            }}
          >
            <AnimatePresence mode="wait">
              {isDone ? (
                <motion.svg
                  key="check"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  width="9" height="9" viewBox="0 0 9 9" fill="none"
                >
                  <path d="M1.5 4.5l2.2 2.2 3.8-3.8" stroke="var(--good)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </motion.svg>
              ) : (
                <motion.span
                  key="dot"
                  style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ink-quaternary)", flexShrink: 0, display: "block", animation: "pulse-dot 1.4s ease-in-out infinite" }}
                />
              )}
            </AnimatePresence>
            <span style={{
              fontSize: 10,
              fontWeight: 500,
              color: isDone ? "var(--good)" : "var(--ink-tertiary)",
              transition: "color 0.35s",
            }}>
              {title}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ── main component ───────────────────────────────────────────────────── */

import React from "react";

export function GenerationProgress({ progressLog }: Props) {
  const stage = deriveStage(progressLog);
  const label = deriveLabel(progressLog);
  const planned = derivePlannedPages(progressLog);
  const done = deriveDonePages(progressLog);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── header card ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          padding: "14px 18px",
          borderRadius: 12,
          background: "var(--bg-surface)",
          boxShadow: "inset 0 0 0 0.5px var(--line-thin), 0 1px 3px rgba(0,0,0,0.04)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* top row: stage + label */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <StageRow stage={stage} />

          <AnimatePresence mode="wait">
            <motion.span
              key={label}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.2 }}
              style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-secondary)", flexShrink: 0 }}
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* page pills */}
        <AnimatePresence>
          {planned.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.3 }}
            >
              <PagePills planned={planned} done={done} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── skeleton canvas ──────────────────────────────────────────────── */}
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {[0, 1, 2, 3].map((i) => (
          <KpiCard key={i} delay={0.04 + i * 0.06} opacity={1 - i * 0.05} />
        ))}
      </div>

      {/* Insight + Chart row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <InsightCard delay={0.18} />
        <ChartCard delay={0.24} />
      </div>

      {/* Table */}
      <TableCard delay={0.32} />

      {/* Second insight row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <InsightCard key={i} delay={0.38 + i * 0.06} />
        ))}
      </div>
    </div>
  );
}
