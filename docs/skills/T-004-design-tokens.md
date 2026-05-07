# T-004 — Add Design Tokens to All Components

**Wave:** 1 — Foundation  
**Estimate:** 0.5 day  
**Depends on:** T-002  
**Blocks:** T-021 (source-flavored theming) and any future component work

---

## Context

Eventually, the platform will support source-flavored theming — Xero data renders with Xero-evocative styling, Plunet data with Plunet-evocative styling. We're not building that now, but we need to make sure components are *capable* of accepting design tokens from the start. Otherwise we'll have to refactor every component later.

This ticket establishes the token system and refactors existing components to use it.

---

## Scope

Define a design token schema. Refactor all existing component primitives to accept tokens via props (with defaults). Establish the default platform token set.

---

## Deliverables

1. Token schema definition (`lib/design/tokens.ts`)
2. Default platform tokens (`lib/design/default-tokens.ts`)
3. All existing primitives refactored to accept and use tokens
4. A `TokenProvider` context that components can pull from
5. Documentation: `docs/design-tokens.md`

---

## Token Schema

Minimum token set:

```typescript
interface DesignTokens {
  colors: {
    primary: string;       // main brand color
    secondary: string;     // accent
    background: string;    // page bg
    surface: string;       // card bg
    text_primary: string;  // main text
    text_secondary: string;// muted text
    border: string;        // divider/border
    success: string;       // positive trend
    warning: string;       // attention
    danger: string;        // negative trend
  };
  typography: {
    font_family: string;
    font_size_base: string;     // e.g., "14px"
    font_size_heading: string;
    font_size_metric: string;   // for KPI numbers
    font_weight_normal: number;
    font_weight_bold: number;
  };
  spacing: {
    unit: string;          // base unit, e.g., "4px"
    card_padding: string;
    section_gap: string;
  };
  radius: {
    card: string;          // border-radius for cards
    button: string;
    input: string;
  };
  shadows: {
    card: string;          // box-shadow for elevated surfaces
    overlay: string;       // for modals/popovers
  };
}
```

---

## Acceptance Criteria

- [ ] `DesignTokens` TypeScript type defined
- [ ] Default platform token set exists in `lib/design/default-tokens.ts`
- [ ] `TokenProvider` React context wraps the app at the top level
- [ ] Every component primitive accepts tokens (either via context or props) — none have hardcoded colors, fonts, or spacing
- [ ] Components fall back to defaults if no tokens are provided
- [ ] `docs/design-tokens.md` documents every token with example values
- [ ] Visual output is identical to before this ticket (defaults match current styling)
- [ ] If any component still has hardcoded styles, it's flagged with a TODO

---

## Notes for the Agent

- Don't try to extract tokens from screenshots in this ticket — that's T-021. Just establish the system.
- Use CSS variables under the hood. Components reference `var(--color-primary)` etc. The TokenProvider sets the variables at the root.
- Tailwind users: configure Tailwind to use the CSS variables, so utility classes like `bg-primary` resolve to the tokens.
- Don't change visual output. Defaults match current styling exactly.
- Don't add a UI for editing tokens. That's a future feature.
