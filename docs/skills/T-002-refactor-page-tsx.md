# T-002 — Refactor page.tsx Into Modular Components

**Wave:** 1 — Foundation  
**Estimate:** 0.5 day  
**Depends on:** T-001  
**Blocks:** T-005, T-006, T-007 (any feature work that touches this file)

---

## Context

The current `page.tsx` is over 1,200 lines in a single file. It contains the source list, the view roster, the detail panel, the Steer chat scaffold, the component renderer, and the AI generation orchestration — all in one place.

Before adding the Steer loop, view persistence, or any new features, this file needs to be broken into modular components. Otherwise every future change creates merge conflicts and regressions.

This is a pure refactor — no behavior changes, no new features.

---

## Scope

Decompose `page.tsx` into focused, single-responsibility components. Move logic to appropriate hooks or utility files. Maintain identical user-facing behavior.

---

## Deliverables

A new component structure under `app/(view-builder)/` (or similar — match the existing convention) with at minimum these files:

```
components/
  source-list/         # Sidebar list of connected sources
  view-roster/         # Grid/list of views per source
  view-detail/         # Active view rendering area
  steer-panel/         # Right-rail Steer chat (scaffold only — actual loop in T-007)
  renderer/            # Component renderer (takes spec, outputs UI)
    primitives/        # Individual primitive components (table, chart, etc.)
hooks/
  use-view-state.ts    # View loading, generation triggers
  use-source-data.ts   # Source data fetching
lib/
  spec-validation.ts   # Existing spec quality checks (move from current location)
```

Specific names can vary — match what already exists in the codebase. The point is decomposition, not naming purity.

---

## Acceptance Criteria

- [ ] `page.tsx` is under 200 lines and only orchestrates layout
- [ ] Each component file is single-responsibility (one component or one concern per file)
- [ ] No component file exceeds 300 lines (further refactor if it does)
- [ ] All existing functionality works identically to before — manual smoke test confirms
- [ ] Imports use clean paths (no deeply nested relative imports like `../../../`)
- [ ] Hooks are extracted for stateful logic that's used in more than one place
- [ ] No prop drilling more than 2 levels deep (use context or co-locate state if it gets that bad)
- [ ] Commits are granular: one commit per logical extraction, not one giant "refactor" commit

---

## Notes for the Agent

- This is a refactor, not a redesign. The behavior must not change. If you find a bug while refactoring, leave it (file an issue) — don't fix it in this PR.
- Don't add tests in this ticket. Tests come later (T-012). For now, manual smoke test is the validation.
- Don't change any styling. The visual output should be pixel-identical.
- Don't introduce new dependencies. Use what's already in `package.json`.
- If you find dead code while refactoring, delete it and note it in the commit message.
