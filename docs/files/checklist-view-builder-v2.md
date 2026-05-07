# View Builder — Requirements Checklist v2

**For:** Issac Brown  
**Last updated:** May 7, 2026  
**Converged with:** Platform Agent & Personnel OS conversations

Check off each item when complete. Items marked ⚡ are blocking other work.

---

## 1. Infrastructure & Security

- [ ] Railway deployment taken offline ⚡
- [ ] App runs locally only until integration plan is approved
- [ ] Supabase credentials not exposed in any public URL or repo
- [ ] OpenRouter API key rate-limited or scoped
- [ ] Integration plan written: how view-builder integrates into platform's three-layer architecture (murmur / surface / dock) ⚡

---

## 2. Spec Format & Abstraction

- [ ] Spec format is abstract — describes *what* to show, not *which component to render* ⚡
- [ ] Example spec shared for review (at least 3 component types) ⚡
- [ ] Thin mapping layer between abstract spec and current renderer
- [ ] Spec includes `view_id`, `view_name`, and `view_type` (spatial / sequential / briefing / card / config)
- [ ] Each component in spec has `mode` field: `static` or `dynamic`
- [ ] Dynamic components have `trigger` field (e.g., `dock_context_change`, `agent_event`, `data_change`)
- [ ] Spec supports `design_tokens` parameter (for source-flavored theming, future)
- [ ] Spec format documented in repo

---

## 3. Shell & Platform Integration

- [ ] Three-layer architecture understood: murmur (top), surface (center), dock (bottom)
- [ ] Generated views render on the surface layer
- [ ] Dock functions as the Steer interface (no separate right-rail needed)
- [ ] Shell loads saved spec on open — no AI generation call for existing views
- [ ] Shell re-renders only dynamic components when triggers fire
- [ ] Auth context passed to generated views (who's viewing, permissions)
- [ ] Action routing centralized through single endpoint
- [ ] All actions logged in events table

---

## 4. Data & Bidirectionality

- [ ] Connector abstraction interface designed ⚡
- [ ] Action spec supports external endpoints (connector, method, payload mapping)
- [ ] Write-back works to local database (current — done)
- [ ] Write-back path designed for external systems (interface only, not implementation)
- [ ] Source data parsing: Markdown ✓ / JSON ✓ / CSV ✓
- [ ] Data binding validation: AI-generated field references checked against actual source fields

---

## 5. View Lifecycle

- [ ] "Save this layout" action — freezes spec as default
- [ ] Saved views load from stored spec + fresh data (no AI call)
- [ ] "Regenerate from scratch" is explicit action, not default
- [ ] Steer modifications (via dock) update saved spec
- [ ] Version history: each spec change creates a version entry
- [ ] Rollback: user can revert to previous version

---

## 6. Multi-View Model

- [ ] Multiple views per source supported
- [ ] Tab UI for switching between views
- [ ] Add view button (triggers generation)
- [ ] Rename, reorder, duplicate, delete views
- [ ] Set default view per source
- [ ] Each view has independent spec, independent dock/Steer history
- [ ] Composed mode: multiple views side by side, independently steerable

---

## 7. Steer Loop (via Dock)

- [ ] Dock chat connected to agent (no separate Steer panel)
- [ ] Three-way message routing:
  - [ ] Ephemeral filter (no spec change)
  - [ ] Layout/content change (spec update → rebuild)
  - [ ] Persistent preference (ToM update — log for now)
- [ ] Streaming progress during regeneration
- [ ] Conversation history maintained per thread
- [ ] Context-aware: dock targets the active view/card automatically
- [ ] Multi-thread: interruptions create new threads, never hijack existing

---

## 8. Rendering — Generative-First + Curated Core

**Core primitives (must be reliable, pre-built):**
- [ ] Data table: sortable, filterable, row-level actions
- [ ] Chart: bar, line, pie
- [ ] KPI strip: metric cards with trend indicators
- [ ] Action buttons: trigger real actions on click
- [ ] Filter bar: dropdowns, date ranges, search
- [ ] Form inputs: text, select, toggle, date picker
- [ ] Flow builder component (React Flow or similar): drag-and-drop blocks + connections

**Each core primitive needs:**
- [ ] Catalog entry: name, description, props schema, rendered preview
- [ ] Props validated before render (graceful fallback on missing data)
- [ ] Accepts design tokens as parameters (not hardcoded styles)

**Sequential primitives (not yet built):**
- [ ] Single-item focus card (one entity, full detail, action bar at bottom)
- [ ] Sequence controller (queue tracking, position, "next" transition)
- [ ] Briefing wrapper ("you have 5 items" opening screen)
- [ ] Batch completion summary

**Generative rendering:**
- [ ] AI can generate full HTML/CSS/JS views from spec (not just compose pre-built components)
- [ ] Generated output follows skill rules (F-pattern for spatial, progressive disclosure for sequential, etc.)
- [ ] Generated views are self-contained HTML bundles (compatible with future MCP Apps delivery)

---

## 9. Skills

Each skill = a SKILL.md file in the repo. Not a prompt buried in code.

**Spatial View Skill:**
- [ ] SKILL.md created with explicit rules
- [ ] Rules: F-pattern, 5-second rule, ≤12 KPIs, chart type matching, working memory limits
- [ ] Rules guide generation (not just validate after)
- [ ] 3–5 golden test cases with expected specs
- [ ] Eval script: runs test cases, scores pass/fail per rule

**Sequential View Skill:**
- [ ] Research completed (NN Group, Lollypop, Sweller cognitive load theory)
- [ ] SKILL.md created
- [ ] Rules: progressive disclosure, ≤4 action buttons, progress visibility, escape hatches, completion summary
- [ ] Covers: checklists, approval queues, review flows, onboarding, handoffs
- [ ] 3–5 golden test cases
- [ ] Eval script

**Briefing View Skill:** (queued)
- [ ] Flagged as queued

**Weighted Card View Skill:** (Month 3)
- [ ] Research: cognitive triage patterns, priority visualization, progressive disclosure
- [ ] SKILL.md created
- [ ] Rules: enough context per card to decide without opening, priority-driven sizing, spatial stability

**Configuration View Skill:** (Month 3)
- [ ] Research: setup wizard patterns, flow board UX, permission management
- [ ] SKILL.md created
- [ ] Rules: hybrid fixed+dynamic, drag-and-drop, authorize/confirm pattern

**Spec Composition Skill:**
- [ ] Documented: how it decides which view-type skill to invoke
- [ ] Handles data semantics, not just data shape

**Data Analysis Skill:**
- [ ] Goes beyond structural (this is a table) to semantic (these are overdue invoices)

**Spec Validation Skill:**
- [ ] Formalized as SKILL.md
- [ ] Checks run per view-type

**Eval Skill:**
- [ ] Basic eval loop: run AI against test cases → score against rubric → pass/fail report

---

## 10. AI Generation Quality

- [ ] Failure patterns logged by category ⚡
- [ ] Breakdown shared for model decision
- [ ] First-attempt success rate tracked per view type
- [ ] Retry loop limited (current: 20 — reduce once prompts improve)
- [ ] AI prompt includes source data sample for field name accuracy
- [ ] Validation errors fed back to AI for self-correction

---

## 11. Skill & Component Library Visibility

- [ ] Index page or README listing all skills with links to SKILL.md files
- [ ] Index page or README listing all component primitives with props + preview
- [ ] Updated every time a skill or component is added/changed
- [ ] Each skill entry: name, purpose, status, which view types use it
- [ ] Each component entry: name, props schema, screenshot, which skills use it

---

## 12. Code Quality

- [ ] `page.tsx` refactored into separate components
- [ ] Tests for spec validation
- [ ] Tests for component rendering
- [ ] Granular commits
- [ ] No dead code in production paths

---

## 13. Documentation

- [ ] PRD v2 stored in `docs/` in repo
- [ ] Spec format documented (field definitions, required vs. optional)
- [ ] Connector interface documented
- [ ] Skill authoring guide: how to write a new SKILL.md
- [ ] Component authoring guide: how to add a new primitive
- [ ] Platform three-layer architecture documented (murmur / surface / dock) — for view-builder integration context

---

## 14. Source Design Tokens (Month 3+)

- [ ] Token schema defined: primary color, secondary color, font family, font sizes, card radius, button style, table density
- [ ] Components accept design tokens as parameters (not hardcoded styles) ⚡ (do this from the start)
- [ ] Default platform token set created
- [ ] One source token set extracted from screenshot (proof of concept)
- [ ] Token set associated with source config in Supabase

---

## 15. MCP Apps Migration (Month 3+)

**Prerequisites:**
- [ ] Abstract spec format stable and documented
- [ ] Component library solid (Spatial + Sequential primitives)
- [ ] At least one view-type skill produces consistently good output

**Proof of concept:**
- [ ] `@modelcontextprotocol/ext-apps` SDK installed and reviewed
- [ ] One existing view re-implemented as an MCP App
- [ ] Bidirectional communication working
- [ ] View renders in Claude or ChatGPT

**Integration:**
- [ ] Build engine produces MCP Apps HTML bundles
- [ ] MCP server registers tools for each saved view
- [ ] Action write-back through `app.callServerTool()`
- [ ] Platform as MCP Apps host (iframe rendering)
- [ ] Composed mode: multiple MCP App iframes, independently interactive

**Multi-surface rendering (stretch):**
- [ ] Same spec → WhatsApp (text + buttons)
- [ ] Same spec → HTML email (digest / surface mail)
- [ ] Same spec → murmur layer (one-line summary)
- [ ] Renderer selection automatic based on delivery channel

---

## Phase Gates

**Gate 1 — Foundation (current):**
Sections 1, 2, 3, 12 complete. Spec format approved. Integration plan approved. Components accept design tokens from the start.

**Gate 2 — Core Loop:**
Sections 4, 5, 6, 7 complete. Dock-as-Steer working. Views save and load. Actions write back.

**Gate 3 — Spatial Quality:**
Spatial View items in section 9 complete. Eval loop running. First-attempt quality acceptable.

**Gate 4 — Sequential Views:**
Sequential View items in sections 8 and 9 complete. Checklists, triage flows, approval queues generate correctly.

**Gate 5 — Production Readiness:**
Sections 10, 11, 13 complete. Library browsable. Documentation current. AI quality tracked.

**Gate 6 — Home Surface + Config:**
Weighted Card View and Configuration View skills complete. Home surface renders ToM-curated cards. Source config with flow board functional.

**Gate 7 — MCP Apps + Multi-Surface:**
Section 15 complete. Views serve as MCP Apps. Platform hosts MCP App views. At least one non-platform surface working (WhatsApp or email).
