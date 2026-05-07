# T-021 — Source Design Tokens From Screenshots

**Wave:** 5 — Month 3+  
**Estimate:** 1 day  
**Depends on:** T-004  
**Blocks:** Source-flavored theming

---

## Context

Users feel more familiar in their data when the UI evokes the source's native interface. Xero data in Xero-flavored styling. Plunet data in Plunet-flavored styling.

We're not pixel-perfect cloning anyone's brand (legal risk + bad practice). We're extracting the *visual language* — color sense, typography feel, spacing rhythm, card style — and applying it as design tokens.

---

## Scope

Build a workflow where a user provides screenshots of a source's native UI, and the system extracts design tokens from them. Apply tokens to a source so views render with that visual language.

---

## Deliverables

1. Token extraction pipeline: screenshot → DesignTokens object
2. UI: in source config (T-020), a "Visual style" section where the user uploads screenshots
3. Token storage: per-source token sets in Supabase
4. Application: when rendering a view of a source, use that source's tokens
5. Default: platform tokens for cross-source views

---

## Token Extraction Pipeline

Approach: AI-driven extraction.

```typescript
async function extractTokensFromScreenshots(images: File[]): Promise<DesignTokens> {
  // Send images + an extraction prompt to a vision-capable model
  const response = await callVisionModel(images, EXTRACTION_PROMPT);
  return parseTokenResponse(response);
}

const EXTRACTION_PROMPT = `
Analyze these screenshots of a software product's UI. Extract a design token set that captures the product's visual language WITHOUT copying any specific branded elements.

Return a JSON object matching this schema: [DesignTokens TypeScript schema]

For colors, return values that are *evocative* of the product's palette but not pixel-identical. For typography, identify the font family category (sans-serif, modern, geometric, etc.) — don't reproduce a copyrighted font choice.
...
`;
```

The prompt explicitly steers away from pixel-perfect copying — we want the *feel*, not the exact identity. Document this in the code comments and in the user-facing UI ("We extract the style, not the brand").

---

## Source Config Integration

In the source config view (T-020), add a section:

**Visual style**
- Description: "Upload 2–4 screenshots of how this source looks. We'll extract a visual style so views of this source feel familiar."
- File input (accepts PNG/JPG, multiple)
- "Extract style" button → runs the pipeline, shows preview
- Preview: a sample card rendered with the extracted tokens
- "Apply this style" / "Try again" / "Use platform default"
- Once applied, all views of this source use the extracted tokens

---

## Storage

```sql
ALTER TABLE sources ADD COLUMN design_tokens JSONB;
```

The tokens are stored on the source record. When rendering a view of that source, the renderer uses these tokens instead of the platform default.

For composed/cross-source views, the renderer uses platform default tokens (since no single source's style applies).

---

## Acceptance Criteria

- [ ] Token extraction pipeline works: takes 2-4 screenshots, returns valid DesignTokens
- [ ] Extraction prompt explicitly avoids pixel-perfect brand copying
- [ ] Source config view has a "Visual style" section
- [ ] User can upload screenshots, preview the extracted tokens, apply them
- [ ] Tokens persist on the source record in Supabase
- [ ] Views of that source render with the source's tokens
- [ ] Cross-source views use platform default tokens
- [ ] User can revert to platform default at any time
- [ ] Documentation in `docs/source-design-tokens.md` explains the legal/ethical stance: we extract style, not brand

---

## Notes for the Agent

- The extraction prompt is the most important piece. Write it carefully. Test it on 3-5 different sources (Xero, Plunet, GitHub, Linear, anything you have screenshots for).
- Don't promise pixel-perfect matches. The pitch is "feels familiar," not "looks identical."
- If the extraction returns junk for a particular source, the user should be able to manually adjust the tokens (a simple form for editing color values, font choices). Don't build a full theme editor — basic edits are enough.
- Test that the tokens *actually feel different* between sources. If the extracted tokens are too similar (e.g., everything ends up looking like a generic SaaS dashboard), the prompt needs work.
- Legal note in the documentation: we are EVOCATIVE not IDENTICAL. Reference the conversation in the PRD's Open Questions section.
