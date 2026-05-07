/**
 * Design token schema for the View Builder.
 *
 * Tokens are the single source of truth for visual values — no component
 * hardcodes colors, fonts, or spacing. The TokenProvider injects these as
 * CSS variables at the root so all components can reference them via
 * var(--token-name) without prop drilling.
 *
 * Full token support: Month 3+ (source-flavored theming via T-021).
 * This foundation is built now so components never need retrofitting.
 */

export interface DesignTokenColors {
  /** Main interactive color — buttons, links, highlights. */
  primary: string;
  /** Accent tint — backgrounds for primary-colored states. */
  primary_tint: string;
  /** Page background. */
  background: string;
  /** Card / panel surface. */
  surface: string;
  /** Nested surface — secondary cards, hover states. */
  surface_secondary: string;
  /** Tertiary surface — chips, selected states. */
  surface_tertiary: string;
  /** Main body text. */
  text_primary: string;
  /** Supporting / secondary text. */
  text_secondary: string;
  /** Muted / placeholder text. */
  text_tertiary: string;
  /** Very muted — metadata, timestamps. */
  text_quaternary: string;
  /** Subtle divider. */
  border: string;
  /** Strong divider. */
  border_strong: string;
  /** Positive — success states, upward trends. */
  success: string;
  success_tint: string;
  /** Attention — warnings, caution states. */
  warning: string;
  warning_tint: string;
  /** Negative — errors, destructive actions, downward trends. */
  danger: string;
  danger_tint: string;
  /** Status colors — used in charts, Gantt bars, status badges. */
  status_done: string;
  status_active: string;
  status_blocked: string;
  status_at_risk: string;
  status_pending: string;
}

export interface DesignTokenTypography {
  font_family: string;
  font_size_xs: string;   // 10px — metadata, timestamps
  font_size_sm: string;   // 11px — labels, captions
  font_size_base: string; // 13px — body text
  font_size_md: string;   // 14px — slightly emphasised body
  font_size_heading: string; // 16px — section headings
  font_size_metric: string;  // 26px — KPI numbers
  font_weight_normal: number;
  font_weight_semibold: number;
  font_weight_bold: number;
  line_height_body: number;
  line_height_tight: number;
}

export interface DesignTokenSpacing {
  /** Base unit — all spacing is derived from multiples of this. */
  unit: string; // 4px
  card_padding: string;
  section_gap: string;
  component_gap: string;
}

export interface DesignTokenRadius {
  card: string;
  button: string;
  input: string;
  badge: string;
  zone: string;
}

export interface DesignTokenShadows {
  card: string;
  overlay: string;
}

export interface DesignTokens {
  colors: DesignTokenColors;
  typography: DesignTokenTypography;
  spacing: DesignTokenSpacing;
  radius: DesignTokenRadius;
  shadows: DesignTokenShadows;
}

/**
 * Partial tokens — used when a source overrides only some values.
 * Deep-merged with the platform defaults at render time.
 */
export type PartialDesignTokens = {
  colors?: Partial<DesignTokenColors>;
  typography?: Partial<DesignTokenTypography>;
  spacing?: Partial<DesignTokenSpacing>;
  radius?: Partial<DesignTokenRadius>;
  shadows?: Partial<DesignTokenShadows>;
};
