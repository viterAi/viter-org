"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { STEER_HINTS } from "../utils";

type Message = { role: "user" | "assistant"; content: string };

type Props = {
  steerMessages: Message[];
  steerInput: string;
  setSteerInput: (v: string) => void;
  steering: boolean;
  steerHintIdx: number;
  sendSteerMessage: () => void;
  sourceId: string;
  hasPages: boolean;
  steerScrollRef: React.RefObject<HTMLDivElement | null>;
  width: number;
};

export function Dock({
  steerMessages, steerInput, setSteerInput,
  steering, steerHintIdx,
  sendSteerMessage, sourceId, hasPages,
  steerScrollRef, width,
}: Props) {
  return (
    <aside
      style={{
        width,
        flexShrink: 0,
        background: "var(--bg-surface)",
        borderRadius: "var(--r-zone)",
        boxShadow: "inset 0 0 0 0.5px var(--line-thin)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div style={{ padding: "13px 16px", borderBottom: "0.5px solid var(--line-thin)", fontSize: 13, fontWeight: 600, flexShrink: 0, letterSpacing: "-0.01em" }}>
        Ask viter
      </div>

      <div
        ref={steerScrollRef}
        style={{ flex: 1, overflowY: "auto", padding: "14px 14px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}
      >
        {steerMessages.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ink-tertiary)", lineHeight: 1.6 }}>
            Ask me to change what you see — e.g. &ldquo;show only overdue items&rdquo; or &ldquo;add a chart for totals by client&rdquo;.
          </div>
        ) : null}

        <AnimatePresence initial={false}>
          {steerMessages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 26 }}
              style={{
                fontSize: 12,
                lineHeight: 1.6,
                padding: "8px 11px",
                borderRadius: 10,
                background: msg.role === "user" ? "var(--accent)" : "var(--bg-secondary)",
                color: msg.role === "user" ? "white" : "var(--ink-secondary)",
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "88%",
                boxShadow: msg.role === "user" ? "0 1px 4px rgba(47,91,255,0.18)" : "none",
              }}
            >
              {msg.content}
            </motion.div>
          ))}
        </AnimatePresence>

        {steering ? (
          <div style={{ alignSelf: "flex-start", width: "88%", display: "flex", flexDirection: "column", gap: 8, padding: "10px 0" }}>
            <div className="chat-skeleton-line" style={{ width: "100%" }} />
            <div className="chat-skeleton-line" style={{ width: "82%" }} />
            <div className="chat-skeleton-line" style={{ width: "91%" }} />
            <div className="chat-skeleton-line" style={{ width: "67%" }} />
            <div className="chat-skeleton-line" style={{ width: "78%" }} />
            <div className="chat-hint-cycle" style={{ marginTop: 2, fontSize: 11, color: "var(--ink-tertiary)" }}>
              {STEER_HINTS[steerHintIdx]}
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ padding: "10px 12px 12px", borderTop: "0.5px solid var(--line-thin)", flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "flex-end", gap: 0,
          borderRadius: 10, border: "1px solid var(--line-strong)",
          background: "var(--bg-secondary)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          overflow: "hidden", transition: "border-color 0.15s",
        }}>
          <input
            value={steerInput}
            onChange={(e) => setSteerInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendSteerMessage(); } }}
            placeholder="Ask to change the view…"
            disabled={steering || !sourceId || !hasPages}
            style={{
              flex: 1, fontSize: 12, padding: "10px 12px",
              border: "none", background: "transparent",
              color: "var(--ink-primary)", outline: "none", minWidth: 0,
            }}
          />
          <button
            onClick={() => void sendSteerMessage()}
            disabled={steering || !steerInput.trim() || !sourceId || !hasPages}
            className={(!steering && steerInput.trim()) ? "btn-solid" : undefined}
            style={{
              all: "unset",
              cursor: steering || !steerInput.trim() ? "default" : "pointer",
              fontSize: 14, width: 36, height: 36, margin: 4, borderRadius: 7,
              background: steering || !steerInput.trim() ? "var(--bg-tertiary)" : "var(--ink-primary)",
              color: steering || !steerInput.trim() ? "var(--ink-quaternary)" : "white",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, transition: "background 0.15s, color 0.15s",
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </aside>
  );
}
