# Autonomous View Builder — PRD & Scope

## What This Is

A system that generates fully functional, personalized dashboards and apps for each source/space in the platform — built by an agent on demand, not hand-designed per source.

The user describes what they want (or the system proposes a default based on available data and ontology). An agent composes a specification. A build engine turns that spec into a working app. The app connects to live data, renders inside the platform shell, and supports bidirectional data flow — changes in the source reflect in the view; actions in the view write back to the source.

---

## Why It Matters

Without this, every new source integration requires a separate design and engineering pass to create its dashboard. That's linear cost per source and kills the platform's ability to scale.

With this, the platform's per-source UI becomes a generated output of the architecture — ontology in, working app out. Every new source gets a view automatically. Personalization comes from the ToM layer. Iteration comes from the Steer loop. The rendering machinery is one investment that compounds.

---

## Core Loop

```
User intent  →  Agent (spec composition)  →  Build engine (app generation)  →  Shell (hosting + data binding)
     ↑                                                                              |
     └────────────────────── Steer loop (refinement) ──────────────────────────────┘
```

---

## Multi-View Model

A single source does not mean a single view. Users can create multiple views of the same source, each showing the data differently — different layouts, different emphasis, different slices. This is a first-class capability, not an edge case.

### How it works

Each source (or space) has a **view collection** — an ordered list of views the user has created. One view is the default. Others are accessible via tabs, a view switcher, or a sidebar index within the source's canvas area.

**Creating views:**
- The system generates a default view when a source is first connected (based on ontology + data + ToM)
- The user can say "add another view of this source" or "show me this data as a kanban board instead" — the agent creates a new spec, the build engine generates a new app, and it's added to the collection
- Views can also be created from the UI: an "Add view" button in the source header, which opens the Steer chat with context pre-filled ("New view for [source]. What would you like to see?")

**Each view is independent:**
- Its own spec (layout, data bindings, filters, emphasis)
- Its own build artifact (a separately generated app)
- Its own Steer history (refinements apply to the active view only)
- Its own refresh/invalidation logic (a KPI dashboard might poll every 30s; a reference table might be static)

**But views share:**
- The same underlying data and connectors (all views of Xero read from the same Xero connection)
- The same ontology and wiki state (the source's structure is shared; views are projections of it)
- The same action routing (marking an invoice "followed up" in any view writes back to the same place)
- The viewer's ToM (personalization applies across views, though each view can override emphasis)

### Canvas layout for multi-view

Two display modes:

**Tabbed** (default) — views appear as tabs in the source header. One view is visible at a time. The user switches between them. Clean and simple; works for most cases.

**Composed** — multiple views are visible simultaneously on the same page, arranged in a grid or vertical stack. The user says "show me the aging table and the cash flow chart side by side" — the shell renders two views in the same canvas. This is more complex but powerful: it turns the source page into a customizable dashboard where each tile is an independently generated view.

The shell needs to support both modes and let the user switch between them. In composed mode, each tile is still a fully independent view with its own spec and its own Steer context — the user clicks into a tile to steer it, or uses the chat to address a specific view by name ("in the aging table, add a column for payment terms").

### View management

- **Rename** — views have user-given names ("Aging Overview," "Pipeline Board," "Weekly KPIs")
- **Reorder** — drag tabs or tiles to rearrange
- **Duplicate** — copy an existing view as a starting point for a new one (copies the spec, generates a fresh build)
- **Delete** — remove a view from the collection
- **Set as default** — choose which view appears when the source is first opened
- **Share** — offer a view's spec to a colleague, who can adopt it into their own collection (it re-renders through their ToM, so personalization is preserved)

### Implications for the spec format

Each view has its own spec. The spec must include a `view_id` and `view_name`. The agent must be able to address a specific view when processing Steer input ("which view is this refinement for?"). The shell must maintain a registry of views per source per user.

### Implications for the build engine

Each view is a separate generation call. In composed mode, multiple generated apps run simultaneously in the same canvas. The shell must isolate them (separate data subscriptions, separate state, separate action routing) while sharing the underlying connector.

---

## Components

### 1. The Agent (Spec Composer)

**What it does:** Takes a user request + source context and produces a structured app specification.

**Inputs:**
- User intent — natural language ("show me aging receivables by client" or "build me a project tracker for this source")
- Source ontology — entity types, relationships, salience map, tenant-specific overlay
- Available data — current state of the source (what's populated, what's active, what's stale)
- Wiki state — open loops, contradictions, engagement context
- Viewer ToM — what this user cares about, their vocabulary, their abstraction level
- Available connectors — what APIs/actions the source exposes

**Outputs — the spec:**
- Data requirements: which entities, which fields, which relationships, what filters
- Layout composition: which UI primitives (table, cards, chart, board, detail panel, KPI row), in what arrangement
- Data bindings: which UI element connects to which data endpoint
- Action affordances: what the user can do from the view (mark as done, reassign, escalate) and where those actions write back to
- Refresh logic: what triggers an update (polling interval, webhook, manual)
- Personalization parameters: what's emphasized, what's de-emphasized, what vocabulary is used

**This is yours to build.** It's the core intelligence of the system and where the platform's ontology/ToM architecture creates unique value.

### 2. The Build Engine (App Generator)

**What it does:** Takes the spec and produces a working, renderable application.

**Option A — Third-party build engine (v0 Platform API)**

Use v0's headless API as the app generator. The agent translates its spec into a v0 prompt with constraints, calls the API, and gets back React/Next.js code.

| Advantage | Tradeoff |
|-----------|----------|
| Production-quality UI generation exists today | Dependency on Vercel's API availability and pricing |
| MCP server available — agent can call v0 as a tool | Generated code is React/Next.js — locks the component format |
| Supports iterative refinement via chat-based follow-ups | Token-based pricing; complex views cost more per generation |
| Produces clean shadcn/ui + Tailwind components | You don't control the generation model or its evolution |
| Deployment infrastructure included if wanted | The generated code still needs your data bindings wired in |
| ~6M+ developers on the platform; well-tested output | |

**How it would work:**
1. Agent composes a detailed prompt from the spec (entity types, layout, data shape, actions)
2. Agent calls v0 Platform API → gets back code files + preview URL
3. Platform extracts the generated components and mounts them in the shell
4. Data bindings are wired post-generation by the shell layer
5. For iterations, agent sends a follow-up message to the same v0 chat → gets updated code

**Other third-party options worth evaluating:**
- **Lovable API** — full-stack generation with Supabase integration; stronger on backend wiring, less mature as a headless/embedded engine
- **Embeddy** — embeddability-first; produces live hosted apps with database/auth/payments included; simpler but less customizable
- **Bolt.new** — fast prototyping with full IDE; less suited to headless/programmatic use

**Option B — Build from scratch (own generation layer)**

Build a proprietary view generator that takes the spec and produces components directly.

| Advantage | Tradeoff |
|-----------|----------|
| Full control over output quality and format | Months of engineering to reach v0-level UI quality |
| No external dependency or per-generation cost | Need to build and maintain a component library |
| Can optimize for your exact hosting shell contract | Must solve the prompt-to-code problem yourself (or use raw LLM calls) |
| Can evolve the generation model with your platform | The generation problem is hard — not your core differentiator |
| Tighter integration with data binding layer | Risk of underinvesting in UI quality vs. spending on architecture |

**How it would work:**
1. Define a component primitive library (table, cards, chart, board, KPI strip, detail panel, filter bar, action buttons)
2. Agent composes a component tree from the spec — which primitives, in what arrangement, with what data bindings
3. A renderer takes the component tree and produces the actual UI (either as React components or as a runtime-interpreted layout)
4. Data bindings are native — the component tree directly references your data layer
5. For iterations, agent modifies the component tree; renderer updates incrementally

**Option C — Hybrid (recommended starting point)**

Start with v0 for generation. Build the shell and agent as if you'll eventually replace v0. Design the spec format to be engine-agnostic — it describes *what* to build, not *how*.

- Phase 1: Agent → spec → v0 API → generated code → shell. Fast path to working prototype.
- Phase 2: Build your own component primitives for the most common patterns (table, cards, KPI row). Use them for simple views; fall back to v0 for complex ones.
- Phase 3: As your primitive library matures, shift generation in-house for standard views. Use v0 only for novel/complex layouts the user requests ad hoc.

This gives you speed now and optionality later. The spec format is the seam — as long as both engines consume the same spec, you can swap without touching the agent or the shell.

### 3. The Shell (Hosting + Data Binding)

**What it does:** Provides the runtime environment where generated apps live and breathe.

**Responsibilities:**
- **Embedding container** — mounts the generated app within the platform's canvas area, inside the existing three-zone layout (left rail, center canvas, right rail/Steer)
- **Auth context** — passes the current viewer's identity and permissions to the app so it can enforce access control
- **Data subscription layer** — connects UI elements to live data from the source connectors; handles refresh (polling, webhooks, or streaming depending on source capability)
- **Action routing** — when the user performs an action in the view (e.g., "mark as followed up"), routes that action back to the source API and updates the wiki layer as appropriate
- **State persistence** — remembers the current view configuration (filters, sort order, layout choices) per user per source
- **Invalidation logic** — knows when to trigger a re-render vs. when the cached view is still valid:
  - New data from source → update content within existing layout
  - Ontology change → regenerate layout structure
  - Wiki state change → re-rank what's foregrounded
  - ToM change → re-render emphasis and vocabulary
  - User steering input → update spec and potentially regenerate

**This is yours to build and is required regardless of which build engine you choose.**

### 4. The Steer Loop (Conversational Refinement)

**What it does:** Lets the user iteratively refine the generated view through the right-rail chat.

**Three types of input, routed to different layers:**
1. **View filter** (ephemeral) — "show only invoices over $5k" → updates the current view's filter state in the shell; no spec change, no regeneration
2. **Layout/content change** (spec update) — "move the aging chart to the top" or "add a column for payment terms" → agent updates the spec → build engine regenerates or patches the app
3. **Persistent preference** (ToM update) — "this client is important, always surface their stuff first" → updates the viewer's ToM → affects this view and all future views for this user

The Steer loop already exists conceptually in the wireframe brief (the right-rail chat with "Ask, tune, or trigger…"). The new work is connecting it to the agent → spec → build engine pipeline rather than having it only control filters.

### 5. The Rendering Primitive Library

**What it does:** Defines the vocabulary of UI components the system can compose.

**Minimum set for v1:**
- **KPI strip** — row of metric cards at the top (total, average, count, trend)
- **Data table** — sortable, filterable, with row-level actions
- **Card grid** — entity cards for browsing (with status indicators, key fields)
- **Timeline/activity feed** — chronological events
- **Chart** — bar, line, pie for aggregate views
- **Board/kanban** — stage-based pipeline view
- **Detail panel** — slide-in for full entity view with related items
- **Filter bar** — dropdowns, date ranges, search
- **Action buttons** — per-row or bulk actions that write back to source

If using v0, this library exists implicitly in what v0 can generate (shadcn/ui components). If building from scratch, this library needs to be designed and implemented explicitly.

---

## Bootstrapping Sequence

**Month 1 — One source, end to end:**
1. Pick the source with the cleanest API and most interesting data shape
2. Build the agent skill for that source (hardcode the ontology for now)
3. Wire to v0 Platform API (or build minimal component tree renderer)
4. Build minimal shell: embedding container + auth context + one data connector
5. Get a working generated view with live data

**Month 2 — Multi-view + Steer loop + second source:**
1. Implement the view collection model (view registry per source per user, tab UI, add/rename/delete)
2. Connect the Steer chat to the agent → spec → rebuild pipeline
3. Implement the three-way routing (filter / spec change / ToM update)
4. Support creating additional views via Steer ("add a board view of this")
5. Add a second source to prove the agent generalizes
6. Add action routing (write-back to source, reflected across all views)

**Month 3 — Composed mode + generalize + polish:**
1. Implement composed canvas mode (multiple views side by side, each independently steerable)
2. Make the agent ontology-driven (reads source ontology dynamically, not hardcoded)
3. Add the invalidation/refresh layer (changes propagate to all active views)
4. Add view sharing (export a spec for a colleague to adopt)
5. Polish the default view generation (first impression on new source)
6. Begin evaluating whether to start building own primitives vs. continuing with v0

---

## What Success Looks Like

- A user connects a new source. The system reads its ontology and data. Within seconds, a working, personalized dashboard appears — not a placeholder, not a loading screen, a real view with real data and real actions.
- The user opens the Steer chat and says "I care more about overdue items than recent activity." The view re-renders with overdue items foregrounded. That preference persists.
- The user says "add another view — show me this as a kanban board grouped by status." A new tab appears with a board view of the same source data. Both views stay live.
- The user says "show me the table and the board side by side." The canvas switches to composed mode with both views visible simultaneously, each independently steerable.
- A colleague opens the same source. They see a different default view because their ToM emphasizes different things. They can adopt a shared view from the first user, and it re-renders through their own ToM.
- When data changes in the source (new invoice created in Xero, new ticket filed in the support system), all active views of that source update without the user refreshing.
- When the user performs an action in any view ("mark as followed up"), it writes back to the source. The change is reflected in every view of that source and in the source's native UI.

---

## View Type Skills — Each Is a Distinct Discipline

The pipeline (agent → spec → build → shell) is shared. But the intelligence inside the agent for each view type is genuinely different. Each view type embodies a different cognitive model, different UX best practices, different information design principles, and different interaction patterns. They should be treated as separate skills, each grounded in researched best practices.

### Skill 1: Spatial Views (Dashboards, Boards, Grids)

**What it is:** Everything visible at once, spatially arranged. The user scans, compares, monitors.

**Core cognitive model:** The user is in *overview mode* — they want to assess state, spot anomalies, compare metrics. The design challenge is information hierarchy: what's most important, what's secondary, what's available on demand.

**Key best practices the skill must encode:**

- **F-pattern scanning:** Eye-tracking research consistently shows users scan dashboards top-left → top-right → down left side. Primary KPIs go top-left with highest contrast and largest font. Secondary metrics go top-right. Detail goes below.
- **5-second rule:** A user should be able to grasp the most critical information within 5 seconds of looking at the dashboard. If they can't, the hierarchy is wrong.
- **Working memory limits:** Users can process 5–9 elements in working memory. Dashboards exceeding 12 KPIs show ~40% engagement drop. The skill must ruthlessly prioritize.
- **Progressive disclosure within spatial layout:** Show KPIs at the top level; let users click to drill into detail. Don't flatten everything onto one surface.
- **Chart type selection:** Each metric type has a correct visualization. Single numbers → large prominent displays with trend context. Comparisons → bar charts. Trends over time → line charts. Part-of-whole → pie/donut. The skill must match data shape to chart type.
- **Grid systems:** 12 or 16 column grids create visual rhythm. Layout should feel systematic, not arbitrary.
- **Color as meaning, not decoration:** Color differentiates categories and indicates status (positive vs. negative trends). It should never be decorative.

**Where to find the knowledge:**
- Nielsen Norman Group (nngroup.com) — foundational research on scanning patterns, information hierarchy, progressive disclosure
- Improvado's Dashboard Design Guide (improvado.io/blog/dashboard-design-guide) — comprehensive 2026 reference with validation criteria
- UXPin dashboard design principles (uxpin.com/studio/blog/dashboard-design-principles) — visual hierarchy, progressive disclosure, responsive patterns
- Stephen Few's "Information Dashboard Design" (book) — canonical reference on dashboard design theory
- Edward Tufte's "The Visual Display of Quantitative Information" (book) — foundational data visualization principles
- Google Material Design and Apple HIG — platform-specific component guidance

### Skill 2: Sequential Views (Triage, Approval Queues, Wizards)

**What it is:** One item at a time, action-driven, advance on completion. The user processes, decides, acts.

**Core cognitive model:** The user is in *decision mode* — they need enough context to make a call, then move to the next item. The design challenge is progressive disclosure: how much to show, when to show it, how to create momentum without sacrificing accuracy.

**Key best practices the skill must encode:**

- **Progressive disclosure (staged):** Show only what's needed for the current decision. Additional detail available on demand but not cluttering the primary view. Each step should feel focused and completable.
- **Hick's Law:** More options increase decision time. Action buttons should be limited to 2–4 clear choices. The email triage example (reply, archive, escalate) is right — not 8 buttons.
- **Progress visibility:** Users need to know where they are in the queue. "3 of 7 emails" or a progress bar. Without this, the task feels unbounded and demotivating.
- **Momentum design:** Each completed action should feel like progress. Micro-interactions (a card sliding away, a counter decrementing, a brief success indicator) create a sense of flow and encourage completion.
- **Context scaffolding:** For each item, show just enough context to decide. For an email, that might be sender, subject, first 2 lines, and which project it relates to. For an invoice, it's amount, client, days overdue, and any related notes. The skill must determine the right "decision context" per entity type.
- **Escape hatches:** "Skip," "Save for later," "I need more info" — the user should never feel trapped in the sequence. Forced linearity without exits creates anxiety.
- **Batch completion summary:** After the sequence, show what was accomplished: "You processed 5 emails: 2 replied, 2 archived, 1 escalated." This provides closure.

**Where to find the knowledge:**
- Nielsen Norman Group on progressive disclosure and wizard patterns (nngroup.com/articles/progressive-disclosure)
- Lollypop Design's wizard UI pattern research (lollypop.design/blog/2026/january/wizard-ui-design) — Airbnb, Duolingo, and Blazeup case studies with sub-step disclosure patterns
- Eleken's wizard UI guide (eleken.co/blog-posts/wizard-ui-pattern-explained) — when to use wizards vs. single-page, real-world case studies
- Sweller's Cognitive Load Theory (1988) — the foundational research on working memory limits and extraneous vs. germane load
- Dan Saffer's "Microinteractions: Designing with Details" (book) — the momentum and feedback patterns that make sequential flows feel alive
- Userpilot's progressive disclosure examples (userpilot.com/blog/progressive-disclosure-examples) — SaaS-specific patterns including checklists, interactive guides, empty states

### Skill 3: Briefing Views (Digests, Morning Summaries, Attention Surfaces)

**What it is:** A curated, time-bounded summary that pulls items from across sources into a narrative or guided sequence. The user catches up, prioritizes, decides where to focus.

**Core cognitive model:** The user is in *orientation mode* — they want to understand what changed, what needs attention, what can wait. The design challenge is curation and prioritization: not "here's everything" but "here's what matters to you right now, and why."

**Key best practices the skill must encode:**

- **Notification fatigue is the enemy.** The average user receives ~160 notifications per month on mobile alone. Briefings must feel like signal, not noise. The skill must aggressively filter and rank.
- **Time-bounded framing:** "Since you last checked" or "Today" or "This week" — the briefing has a temporal scope that sets expectations. Without it, the user doesn't know if they're looking at everything ever or just what's new.
- **Cross-source synthesis, not cross-source listing.** A briefing that says "3 new Xero invoices, 2 new emails, 1 Plunet deadline" is just a notification feed. A good briefing says "The Acme project has 3 things that need your attention: an overdue invoice ($12k, 15 days), an unanswered email from their PM, and a deadline tomorrow on the translation job." The skill must synthesize across sources around the entities and topics the user cares about.
- **Actionability.** Every item in a briefing should either be directly actionable (with inline action buttons) or informational with a clear "go deeper" path. Items that are neither actionable nor informative don't belong.
- **Prioritization hierarchy:** Urgent → important → informational. Items requiring action before items that are awareness-only. The ToM drives what "important" means for this user.
- **Completion signal.** The briefing should have an end. "You're caught up" is a powerful moment. Open-ended feeds create anxiety; finite briefings create closure.
- **Push vs. pull timing.** When is the briefing delivered? On login? At a scheduled time? On demand? The skill should support all three, with the default being "on first open of the day."

**Where to find the knowledge:**
- Smashing Magazine's notification UX guidelines (smashingmagazine.com/2025/07/design-guidelines-better-notifications-ux) — timing, frequency, and fatigue research
- Department of Product's deep dive on notification UX (departmentofproduct.substack.com) — analysis of 20+ companies' notification patterns including Google, Slack, Notion, Linear
- Vitaly Friedman's "Smart Interface Design Patterns" (video course) — covers notifications, digests, and attention management patterns
- Gartner's research on "data stories" — by 2025, data stories were projected to be the most widespread way of consuming analytics, with 75% auto-generated. Briefings are this pattern applied to operational data.
- Apple Intelligence's notification summarization (case study in what went wrong) — illustrative of the risks of AI-generated summaries when the curation isn't good enough

### How the skills relate

All three skills share:
- The same spec format (they all produce specs the build engine can consume)
- The same data binding and action routing infrastructure (the shell)
- The same ToM-driven personalization (the viewer parameter)
- The same Steer loop for refinement

Each skill owns:
- Its own cognitive model and layout logic
- Its own best practices for information hierarchy, disclosure patterns, and interaction design
- Its own primitive set (a sequential view uses card-stack + action-bar + progress-indicator; a dashboard uses grid + KPI-strip + chart + table)
- Its own quality criteria (a dashboard is good if you can grasp the state in 5 seconds; a sequential view is good if you can process each item without hesitation; a briefing is good if you feel caught up and know what to do next)

### Research scope for the engineer

For each skill, the engineer writing the skill definition should:

1. **Read the foundational references** listed above — not to become a UX expert, but to extract the concrete rules the agent needs to follow when composing a spec of that type
2. **Distill into decision rules** that the agent can apply: "if the data has >12 entities, use progressive disclosure," "if the view is sequential, limit actions to 3 buttons," "if it's a briefing, group by entity/topic not by source"
3. **Create a test suite** of example specs per view type — "given this ontology and data shape, what spec should the agent produce?" — so the skill's output can be evaluated against known-good patterns
4. **Identify the primitive set** each skill needs from the rendering library, and flag any gaps

This research is a prerequisite for building the skills, not a nice-to-have. The difference between a generated view that feels right and one that feels like a random arrangement of components is entirely in this layer.

---

## Open Questions for Design Review

1. **First-view quality bar** — how good does the auto-generated default need to be before users trust the system? Is "functional but generic" okay if Steer makes it easy to improve, or does the first impression need to be opinionated and sharp?
2. **Component format commitment** — if we start with v0, we're generating React. Is the platform committed to React for embedded views, or do we need an abstraction layer that could target other renderers?
3. **Offline/degraded states** — what happens when the source connector goes down? Does the view show stale data with a staleness indicator, or does it fail visibly?
4. **Version history** — should users be able to revert to a previous version of their view? How far back?
5. **Sharing views** — can a user share their customized view with a colleague? Does it carry the ToM personalization or just the layout?
6. **Cost model** — if using v0, each generation/iteration costs tokens. Who absorbs that cost? Is there a generation budget per source per user? How does this affect the Steer loop (should it batch changes rather than regenerating on every message)?
7. **View limits** — is there a maximum number of views per source? Composed mode with 10 views is technically possible but probably unusable. Where's the practical ceiling?
8. **Cross-source composed views** — can a user compose views from *different* sources on the same canvas? ("Show me Xero aging next to Plunet deadlines.") This is essentially what Spaces do, but at the view level. Worth deciding whether this is a view-builder feature or a Spaces feature.
9. **View templates** — should the system ship pre-built view templates per source type (e.g., "Standard Accounting Dashboard" for any accounting source)? These would be starting points the user can then customize via Steer. Could accelerate first-view quality significantly.
