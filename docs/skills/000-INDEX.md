# View Builder — Ticket Index & Execution Plan

This is the orchestration document. Each ticket below is a self-contained scope that can be handed off to a coding agent. Tickets are designed to be:
- **Bounded** — each one is completable in 0.5 to 2 days of focused work
- **Meaningful** — each one produces a real, testable deliverable
- **Self-contained** — has all the context and acceptance criteria needed
- **Dependency-aware** — knows what must come before and what can run in parallel

---

## How to Use This

1. Pick the next unblocked ticket from the execution plan below
2. Hand the ticket file to a coding agent (Claude Code, Cursor, etc.) as the full scope
3. The agent reads the ticket, executes the work, and checks off the acceptance criteria
4. Review the agent's output against the acceptance criteria
5. Mark the ticket complete and proceed

---

## Execution Plan

### Wave 1 — Foundation ✅ Complete

All Wave 1 tickets are done as of May 10, 2026. Wave 2 is unblocked.

| # | Ticket | Status |
|---|--------|--------|
| 1 | T-001 — Take Railway offline & secure prototype | ✅ Done |
| 2 | T-002 — Refactor page.tsx into modular components | ✅ Done — `page.tsx` 141 lines; components in `app/components/`; hooks in `app/hooks/` |
| 3 | T-003 — Design abstract spec format | ✅ Done — `lib/types/spec.ts`, `lib/view/spec-mapper.ts`, `docs/spec-format.md`, `docs/spec-examples/`; AI prompt updated |
| 4 | T-004 — Add design tokens to all components | ✅ Done — `lib/design/tokens.ts`, `lib/design/default-tokens.ts`, `lib/design/TokenProvider.tsx`, `docs/design-tokens.md` |

### Wave 2 — Core Loop (can run mostly in parallel after Wave 1)

| # | Ticket | Est. | Depends on |
|---|--------|------|------------|
| 5 | T-005 — View persistence: save/load/regenerate | 1d | T-003 |
| 6 | T-006 — Connector abstraction interface | 1d | T-003 |
| 7 | T-007 — Steer loop integration via dock | 1.5d | T-003, T-005 |
| 8 | T-008 — Multi-view model (tabs, add/rename/delete) | 1d | T-005 |
| 9 | T-009 — AI failure pattern logging | 0.5d | T-002 |

### Wave 3 — Skills & Quality (after Wave 2)

| # | Ticket | Est. | Depends on |
|---|--------|------|------------|
| 10 | T-010 — Formalize Spatial View skill (SKILL.md) | 0.5d | T-003 |
| 11 | T-011 — Skill & component library index page | 0.5d | T-002, T-004 |
| 12 | T-012 — Spatial View golden test cases & eval loop | 1d | T-010 |
| 13 | T-013 — Documentation: spec, connector, authoring guides | 0.5d | T-003, T-006 |

### Wave 4 — Sequential Views (after Wave 3)

| # | Ticket | Est. | Depends on |
|---|--------|------|------------|
| 14 | T-014 — Research & write Sequential View skill | 1d | T-010 |
| 15 | T-015 — Sequential view primitives (focus card, sequence controller, etc.) | 1d | T-014 |
| 16 | T-016 — Sequential View golden tests & eval | 0.5d | T-014, T-015 |

### Wave 5 — Month 3 work (after Waves 1-4 are solid)

| # | Ticket | Est. | Depends on |
|---|--------|------|------------|
| 17 | T-017 — MCP Apps proof of concept | 1d | T-003, T-007 |
| 18 | T-018 — Build engine produces MCP Apps HTML bundles | 1.5d | T-017 |
| 19 | T-019 — Weighted Card View skill (home surface) | 1.5d | T-014 |
| 20 | T-020 — Configuration View skill (source config + flow board) | 2d | T-014, T-006 |
| 21 | T-021 — Source design tokens from screenshots | 1d | T-004 |
| 22 | T-022 — Multi-surface renderer: WhatsApp + email | 1.5d | T-018 |
| 23 | T-023 — genUI ingest: Arcade raw relay, `genui_ingest_jobs`, worker, `genui_channels` | 2–3d | `genui_l2` migration in vita-compare |

---

## Parallelization Map

After Wave 1 is complete, these groups can run in parallel:

**Group A (Data flow):** T-005 → T-008
**Group B (Bidirectionality):** T-006 → T-013
**Group C (Interaction):** T-007
**Group D (Quality):** T-009, T-010 → T-012

After Wave 3 is complete:
**Group E (Sequential):** T-014 → T-015 → T-016

After Wave 4:
**Group F (Delivery):** T-017 → T-018 → T-022
**Group F2 (genUI data plane):** T-023 (vita-compare Supabase + automation; can run in parallel with T-022 once repo ownership is clear)
**Group G (Advanced views):** T-019, T-020 (parallel)
**Group H (Theming):** T-021

---

## Best Practices for Coding Agents

When handing a ticket to an AI coding agent, include this preamble:

> You are working on the View Builder project. The full PRD is in `docs/prd-view-builder-v2.md`. Your scope for this session is the attached ticket only — do not expand scope, do not refactor unrelated code, do not add features beyond what's specified.
> 
> Before writing code:
> 1. Read the entire ticket
> 2. Confirm you understand the deliverables and acceptance criteria
> 3. Check the dependencies — if any aren't complete, stop and report
> 4. Plan your approach (file changes, new files, tests) before writing
> 
> While writing code:
> 1. Follow the file structure and naming conventions in the existing repo
> 2. Use existing utilities and patterns rather than inventing new ones
> 3. Add tests where the ticket specifies
> 4. Keep commits granular and well-described
> 
> When done:
> 1. Check off every acceptance criterion in the ticket
> 2. If any criterion can't be met, document why
> 3. Provide a brief summary of what was built and any decisions made
> 4. Flag any new questions or concerns surfaced by the work

---

## Tickets

The individual ticket files are:
- T-001-take-railway-offline.md
- T-002-refactor-page-tsx.md
- T-003-spec-format.md
- T-004-design-tokens.md
- T-005-view-persistence.md
- T-006-connector-abstraction.md
- T-007-steer-loop-dock.md
- T-008-multi-view-model.md
- T-009-ai-failure-logging.md
- T-010-spatial-skill.md
- T-011-library-index.md
- T-012-spatial-eval.md
- T-013-documentation.md
- T-014-sequential-skill.md
- T-015-sequential-primitives.md
- T-016-sequential-eval.md
- T-017-mcp-apps-poc.md
- T-018-mcp-apps-build-engine.md
- T-019-weighted-card-skill.md
- T-020-config-view-skill.md
- T-021-source-design-tokens.md
- T-022-multi-surface-renderer.md
- T-023-genui-webhook-ingest.md
