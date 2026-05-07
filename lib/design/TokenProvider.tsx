"use client";

import React, { createContext, useContext, useEffect, useRef } from "react";
import type { DesignTokens, PartialDesignTokens } from "./tokens";
import { DEFAULT_TOKENS } from "./default-tokens";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const TokenContext = createContext<DesignTokens>(DEFAULT_TOKENS);

export function useTokens(): DesignTokens {
  return useContext(TokenContext);
}

// ---------------------------------------------------------------------------
// CSS variable mapping
// Maps each token path to its CSS variable name.
// Components reference var(--token-name); the provider sets the values.
// ---------------------------------------------------------------------------

function tokensToCssVars(tokens: DesignTokens): Record<string, string> {
  const c = tokens.colors;
  const t = tokens.typography;
  const s = tokens.spacing;
  const r = tokens.radius;
  const sh = tokens.shadows;

  return {
    // Colors
    "--color-primary":           c.primary,
    "--color-primary-tint":      c.primary_tint,
    "--color-background":        c.background,
    "--color-surface":           c.surface,
    "--color-surface-secondary": c.surface_secondary,
    "--color-surface-tertiary":  c.surface_tertiary,
    "--color-text-primary":      c.text_primary,
    "--color-text-secondary":    c.text_secondary,
    "--color-text-tertiary":     c.text_tertiary,
    "--color-text-quaternary":   c.text_quaternary,
    "--color-border":            c.border,
    "--color-border-strong":     c.border_strong,
    "--color-success":           c.success,
    "--color-success-tint":      c.success_tint,
    "--color-warning":           c.warning,
    "--color-warning-tint":      c.warning_tint,
    "--color-danger":            c.danger,
    "--color-danger-tint":       c.danger_tint,
    "--color-status-done":       c.status_done,
    "--color-status-active":     c.status_active,
    "--color-status-blocked":    c.status_blocked,
    "--color-status-at-risk":    c.status_at_risk,
    "--color-status-pending":    c.status_pending,

    // Typography
    "--font-family":          t.font_family,
    "--font-size-xs":         t.font_size_xs,
    "--font-size-sm":         t.font_size_sm,
    "--font-size-base":       t.font_size_base,
    "--font-size-md":         t.font_size_md,
    "--font-size-heading":    t.font_size_heading,
    "--font-size-metric":     t.font_size_metric,
    "--font-weight-normal":   String(t.font_weight_normal),
    "--font-weight-semibold": String(t.font_weight_semibold),
    "--font-weight-bold":     String(t.font_weight_bold),
    "--line-height-body":     String(t.line_height_body),
    "--line-height-tight":    String(t.line_height_tight),

    // Spacing
    "--spacing-unit":          s.unit,
    "--spacing-card-padding":  s.card_padding,
    "--spacing-section-gap":   s.section_gap,
    "--spacing-component-gap": s.component_gap,

    // Radius
    "--radius-card":   r.card,
    "--radius-button": r.button,
    "--radius-input":  r.input,
    "--radius-badge":  r.badge,
    "--radius-zone":   r.zone,

    // Shadows
    "--shadow-card":    sh.card,
    "--shadow-overlay": sh.overlay,

    // Legacy aliases — map new token vars to the existing globals.css names so
    // components that reference the old names continue to work without changes.
    "--accent":          c.primary,
    "--accent-tint":     c.primary_tint,
    "--bg-page":         c.background,
    "--bg-surface":      c.surface,
    "--bg-secondary":    c.surface_secondary,
    "--bg-tertiary":     c.surface_tertiary,
    "--ink-primary":     c.text_primary,
    "--ink-secondary":   c.text_secondary,
    "--ink-tertiary":    c.text_tertiary,
    "--ink-quaternary":  c.text_quaternary,
    "--line-thin":       c.border,
    "--line-strong":     c.border_strong,
    "--good":            c.success,
    "--good-tint":       c.success_tint,
    "--warn":            c.warning,
    "--warn-tint":       c.warning_tint,
    "--danger":          c.danger,
    "--danger-tint":     c.danger_tint,
    "--r-card":          r.card,
    "--r-zone":          r.zone,
    "--font-sans":       t.font_family,
  };
}

function applyVars(el: HTMLElement, vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) {
    el.style.setProperty(key, value);
  }
}

// ---------------------------------------------------------------------------
// Deep merge utility — used when a source provides partial token overrides
// ---------------------------------------------------------------------------

export function mergeTokens(
  base: DesignTokens,
  overrides: PartialDesignTokens
): DesignTokens {
  return {
    colors:     { ...base.colors,     ...(overrides.colors     ?? {}) },
    typography: { ...base.typography, ...(overrides.typography ?? {}) },
    spacing:    { ...base.spacing,    ...(overrides.spacing    ?? {}) },
    radius:     { ...base.radius,     ...(overrides.radius     ?? {}) },
    shadows:    { ...base.shadows,    ...(overrides.shadows    ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// TokenProvider
// ---------------------------------------------------------------------------

interface TokenProviderProps {
  children: React.ReactNode;
  /** Optional source-level token overrides — deep-merged with defaults. */
  overrides?: PartialDesignTokens;
}

/**
 * Wraps the app at the root level. Injects all tokens as CSS variables on
 * <html> so every component can reference them via var(--token-name).
 *
 * When `overrides` are provided (e.g. for a source-flavored view), only the
 * overridden values change — the rest fall back to platform defaults.
 */
export function TokenProvider({ children, overrides }: TokenProviderProps) {
  const tokens = overrides ? mergeTokens(DEFAULT_TOKENS, overrides) : DEFAULT_TOKENS;
  const cssVars = tokensToCssVars(tokens);
  const appliedRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    applyVars(root, cssVars);
    appliedRef.current = true;
  }, [JSON.stringify(cssVars)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TokenContext.Provider value={tokens}>
      {children}
    </TokenContext.Provider>
  );
}
