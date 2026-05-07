import type { DesignTokens } from "./tokens";

/**
 * Default platform token set.
 *
 * Values match the CSS variables already defined in globals.css.
 * The TokenProvider injects these as CSS variables at the root on first load.
 * Source-flavored overrides (T-021) deep-merge on top of these.
 */
export const DEFAULT_TOKENS: DesignTokens = {
  colors: {
    primary:           "#2f5bff",
    primary_tint:      "#e6ecff",
    background:        "#f4f2ee",
    surface:           "#ffffff",
    surface_secondary: "#f7f5f1",
    surface_tertiary:  "#efebe4",
    text_primary:      "#1a1a1a",
    text_secondary:    "#5a5650",
    text_tertiary:     "#9a938a",
    text_quaternary:   "#c7bfb4",
    border:            "rgba(26, 26, 26, 0.08)",
    border_strong:     "rgba(26, 26, 26, 0.16)",
    success:           "#2d7a4f",
    success_tint:      "#def0e5",
    warning:           "#c58a1b",
    warning_tint:      "#fbf1dc",
    danger:            "#c2410c",
    danger_tint:       "#fbe7dc",
    // Status colors — vivid fills for charts, Gantt bars, badges
    status_done:       "#10b981",
    status_active:     "#2f5bff",
    status_blocked:    "#ef4444",
    status_at_risk:    "#f59e0b",
    status_pending:    "#94a3b8",
  },
  typography: {
    font_family:       "'Inter', system-ui, -apple-system, sans-serif",
    font_size_xs:      "10px",
    font_size_sm:      "11px",
    font_size_base:    "13px",
    font_size_md:      "14px",
    font_size_heading: "16px",
    font_size_metric:  "26px",
    font_weight_normal:   400,
    font_weight_semibold: 600,
    font_weight_bold:     700,
    line_height_body:  1.6,
    line_height_tight: 1.3,
  },
  spacing: {
    unit:           "4px",
    card_padding:   "16px",
    section_gap:    "24px",
    component_gap:  "12px",
  },
  radius: {
    card:   "6px",
    button: "5px",
    input:  "5px",
    badge:  "4px",
    zone:   "8px",
  },
  shadows: {
    card:    "0 1px 3px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(26,26,26,0.08)",
    overlay: "0 8px 24px rgba(0,0,0,0.12)",
  },
};
