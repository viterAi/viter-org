# Design Tokens

**Status:** Implemented — foundation complete (T-004)  
**Source-flavored theming:** Month 3+ (T-021)

---

## What This Is

Design tokens are the single source of truth for every visual value in the View Builder — colors, typography, spacing, radius, shadows. No component hardcodes any of these values. They all reference CSS variables which are set by the `TokenProvider`.

This means swapping the entire visual language of a view (e.g. to match a source's branding in T-021) requires only passing a `PartialDesignTokens` override to `TokenProvider` — no component changes.

---

## How It Works

```
DEFAULT_TOKENS (lib/design/default-tokens.ts)
  + optional PartialDesignTokens override
      ↓ mergeTokens()
  resolved DesignTokens
      ↓ TokenProvider (lib/design/TokenProvider.tsx)
  CSS variables injected on <html>
      ↓
  every component references var(--token-name)
```

The `TokenProvider` wraps the app in `app/layout.tsx`. On mount it sets all token values as CSS variables on `document.documentElement`. Legacy variable names (e.g. `--accent`, `--bg-page`) are aliased so existing components continue to work without changes.

---

## Token Reference

### Colors

| Token | CSS Variable | Default | Purpose |
|-------|-------------|---------|---------|
| `colors.primary` | `--color-primary` | `#2f5bff` | Buttons, links, active states |
| `colors.primary_tint` | `--color-primary-tint` | `#e6ecff` | Primary state backgrounds |
| `colors.background` | `--color-background` | `#f4f2ee` | Page background |
| `colors.surface` | `--color-surface` | `#ffffff` | Card / panel background |
| `colors.surface_secondary` | `--color-surface-secondary` | `#f7f5f1` | Nested cards, hover |
| `colors.surface_tertiary` | `--color-surface-tertiary` | `#efebe4` | Chips, selected states |
| `colors.text_primary` | `--color-text-primary` | `#1a1a1a` | Main body text |
| `colors.text_secondary` | `--color-text-secondary` | `#5a5650` | Supporting text |
| `colors.text_tertiary` | `--color-text-tertiary` | `#9a938a` | Labels, captions |
| `colors.text_quaternary` | `--color-text-quaternary` | `#c7bfb4` | Metadata, timestamps |
| `colors.border` | `--color-border` | `rgba(26,26,26,0.08)` | Subtle dividers |
| `colors.border_strong` | `--color-border-strong` | `rgba(26,26,26,0.16)` | Visible dividers |
| `colors.success` | `--color-success` | `#2d7a4f` | Positive text states |
| `colors.success_tint` | `--color-success-tint` | `#def0e5` | Success backgrounds |
| `colors.warning` | `--color-warning` | `#c58a1b` | Warning text |
| `colors.warning_tint` | `--color-warning-tint` | `#fbf1dc` | Warning backgrounds |
| `colors.danger` | `--color-danger` | `#c2410c` | Error text, destructive |
| `colors.danger_tint` | `--color-danger-tint` | `#fbe7dc` | Error backgrounds |

**Status colors** — vivid fills for charts, Gantt bars, badges:

| Token | CSS Variable | Default |
|-------|-------------|---------|
| `colors.status_done` | `--color-status-done` | `#10b981` |
| `colors.status_active` | `--color-status-active` | `#2f5bff` |
| `colors.status_blocked` | `--color-status-blocked` | `#ef4444` |
| `colors.status_at_risk` | `--color-status-at-risk` | `#f59e0b` |
| `colors.status_pending` | `--color-status-pending` | `#94a3b8` |

---

### Typography

| Token | CSS Variable | Default |
|-------|-------------|---------|
| `typography.font_family` | `--font-family` | Inter, system-ui |
| `typography.font_size_xs` | `--font-size-xs` | `10px` |
| `typography.font_size_sm` | `--font-size-sm` | `11px` |
| `typography.font_size_base` | `--font-size-base` | `13px` |
| `typography.font_size_md` | `--font-size-md` | `14px` |
| `typography.font_size_heading` | `--font-size-heading` | `16px` |
| `typography.font_size_metric` | `--font-size-metric` | `26px` |
| `typography.font_weight_normal` | `--font-weight-normal` | `400` |
| `typography.font_weight_semibold` | `--font-weight-semibold` | `600` |
| `typography.font_weight_bold` | `--font-weight-bold` | `700` |
| `typography.line_height_body` | `--line-height-body` | `1.6` |
| `typography.line_height_tight` | `--line-height-tight` | `1.3` |

---

### Spacing

| Token | CSS Variable | Default |
|-------|-------------|---------|
| `spacing.unit` | `--spacing-unit` | `4px` |
| `spacing.card_padding` | `--spacing-card-padding` | `16px` |
| `spacing.section_gap` | `--spacing-section-gap` | `24px` |
| `spacing.component_gap` | `--spacing-component-gap` | `12px` |

---

### Radius

| Token | CSS Variable | Default |
|-------|-------------|---------|
| `radius.card` | `--radius-card` | `6px` |
| `radius.button` | `--radius-button` | `5px` |
| `radius.input` | `--radius-input` | `5px` |
| `radius.badge` | `--radius-badge` | `4px` |
| `radius.zone` | `--radius-zone` | `8px` |

---

### Shadows

| Token | CSS Variable | Default |
|-------|-------------|---------|
| `shadows.card` | `--shadow-card` | subtle lift + hairline border |
| `shadows.overlay` | `--shadow-overlay` | modal / popover elevation |

---

## Using Tokens in Components

**In inline styles (JSX):**
```tsx
<div style={{ color: "var(--color-text-secondary)", fontSize: "var(--font-size-sm)" }}>
  Label
</div>
```

**In CSS / globals.css:**
```css
.my-component {
  background: var(--color-surface);
  border-radius: var(--radius-card);
  padding: var(--spacing-card-padding);
}
```

**Via the React context (when you need the TypeScript value):**
```tsx
import { useTokens } from "@/lib/design/TokenProvider";

function MyComponent() {
  const tokens = useTokens();
  // tokens.colors.primary === "#2f5bff"
}
```

---

## Source-Flavored Overrides (Month 3+ — T-021)

When a view is associated with a source that has extracted design tokens, pass them as `overrides` to `TokenProvider`:

```tsx
<TokenProvider overrides={{ colors: { primary: "#0078d4", primary_tint: "#e8f1fb" } }}>
  <SourceView />
</TokenProvider>
```

Only the overridden values change. Everything else falls back to platform defaults.

---

## Legacy Variable Aliases

The old CSS variable names (`--accent`, `--bg-page`, `--ink-tertiary`, etc.) are preserved as aliases in `globals.css` and also kept in sync by `TokenProvider`. Existing components that reference the old names continue to work. New components should use the canonical `--color-*` names.
