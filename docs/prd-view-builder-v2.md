# Autonomous View Builder — PRD v2 (Converged)

## What This Is

A system that generates fully functional, personalized views across the platform — built by agents on demand, not hand-designed per source or per screen. Views render inside the platform's three-layer architecture (murmur layer, surface, dock) and can surface in any channel (platform, Claude, ChatGPT, WhatsApp, email).

This is not a dashboard builder. It's the platform's visual rendering engine. Everything the user sees — weighted cards on their home surface, source-specific data views, sequential triage flows, daily briefings, configuration panels, agent management — is an output of this system.

---

## How It Fits the Platform Architecture

The platform has three permanent layers:

**Murmur layer** (top) — ambient awareness stream. Updates, notifications, status changes. ToM-curated. Tappable to expand into a card or generate a view.

**Surface** (center) — the main visual workspace. Weighted cards, generated views, expanded cards with gen UI. Changes based on context (Home, a space, a source config). This is where the view-builder's output lives.

**Dock** (bottom) — conversational layer. Always present. Expands upward. Context-aware. ToM and other agents live here. This is where the Steer loop happens — the dock IS the Steer chat, scoped to whatever the user is looking at on the surface.

The view-builder generates content for the **surface**. The **dock** drives refinement (Steer loop). The **murmur layer** consumes lightweight renderings of the same specs (one-line summaries, counts, alerts).

---

## Core Loop

```
Context (ToM + ontology + data + user intent)
  → Agent (spec composition, guided by view-type skills)
  → Build engine (generates HTML/component bundle)
  → Surface (renders in the appropriate layer)
      ↕ Bidirectional data flow (source ↔ view)
  ← Dock (Steer loop — refine, act, save)
```

---

## Source Configuration, Not Source Augmentation

Each connected source does NOT get its own augmented dashboard view by default. Instead, each source gets a **configuration surface** where the user defines:
- What data matters from this source
- How things are organized
- What to pay attention to
- Permissions (read/write/delete, per category, per person)

This config feeds ToM so he knows what's important from each source.

When the user needs to see source data, they don't navigate to a source page — they ask ToM (via the dock) or tap a card on the surface, and ToM brings up a **generated UI component** that may visually echo the source's native interface, rendered inline on the surface.

There should also be a **visual flow board** — a block-based view of how information moves between sources, agents, and users. The system builds it on the user's behalf, but the user can rearrange blocks, correct routing, and authorize flows. This is the hybrid fixed+dynamic pattern: the flow board layout is stable, but the blocks and connections are dynamic and the user can drag-and-drop to reconfigure.

---

## The Home Surface — The User's OS

The home page is not a dashboard. It's a **cognitive surface** organized around how the user's mind works, not around where data comes from.

**Weighted cards** — each card shows enough context to make a decision without opening it. "3 invoices from Acme need approval — $14k total, due Friday" rather than "Invoices: 3." Cards are sized and positioned by priority as ToM understands it. Bigger, higher cards for urgent items. Smaller cards for awareness. Stale items fade.

**Progressive disclosure** — cards expand in place. Tap a card → it opens right where it is, pushing others aside, revealing generated UI and a communication thread. Go deeper → it takes over more of the screen. Three levels: glance (card), engage (expanded with gen UI), immerse (full-screen focused mode).

**The card becomes the action pad.** You don't navigate to an action pad — the card becomes it when you engage deeply enough.

**Murmur layer at top** — ambient updates from across all sources and agents. ToM-filtered. Tappable to expand or generate a view.

---

## View Types

Views are generated outputs of the spec → build pipeline. Each type has its own skill (distinct cognitive model, UX best practices, interaction patterns).

### Spatial Views (Dashboards, Boards, Grids)

User is in overview mode — scanning, comparing, monitoring. Fixed layout, live data.

Key rules: F-pattern hierarchy, 5-second comprehension, ≤12 KPIs, chart type matching, working memory limits. See Spatial View SKILL.md for full best practices.

### Sequential Views (Triage, Queues, Wizards, Checklists)

User is in decision mode — one item at a time, act, advance. Covers email triage, approval queues, review flows, onboarding sequences, handoffs, checklists extracted from PRDs.

Key rules: progressive disclosure, ≤4 action buttons (Hick's Law), progress visibility, escape hatches, momentum design, batch completion summary.

### Briefing Views (Digests, Summaries, Attention Surfaces)

User is in orientation mode — catching up, prioritizing, deciding where to focus. Cross-source synthesis, not cross-source listing.

Key rules: time-bounded framing, actionability, prioritization hierarchy, completion signal ("you're caught up").

### Weighted Card Views (The Home Surface)

User is in triage mode — scanning a living surface of ToM-curated items. This is the home page pattern. Cards have weight, expand in place, become action pads.

Key rules: enough context per card to decide without opening, priority-driven sizing/positioning, progressive disclosure (glance → engage → immerse), spatial stability (cards don't jump around while you're looking at them — they recalculate on open/refresh).

### Configuration Views (Source Config, Flow Board, Permissions)

User is in setup mode — defining how things work, not consuming data. The hybrid fixed+dynamic pattern: stable layout, interactive components the user manipulates (drag-and-drop blocks, toggle permissions, connect flow paths), with an authorize/confirm action that commits changes.

---

## Fixed + Dynamic Hybrid Pattern

Views are not fully fixed or fully generated. They're hybrid:

**The layout is stable** — sections, arrangement, primary structure. Doesn't change on every load.

**Some components are dynamic** — respond to context in real time. A project board with fixed columns but items that shift based on agent analysis. A dashboard with a fixed KPI strip but one card that updates based on the dock conversation.

**Spec marks each component:**
- `mode: "static"` — data refreshes, structure doesn't change
- `mode: "dynamic"` — can be swapped/updated based on triggers
- `trigger` field for dynamic components: `copilot_context_change`, `agent_event`, `data_change`

**The flow for locking in a view:**
1. AI generates a proposal (or user picks from suggestions)
2. User steers via dock
3. User says "save this" → layout freezes as default
4. From now on, view loads saved spec + fresh data (no AI call)
5. Dock modifications update saved spec (with versioning)
6. "Regenerate from scratch" is explicit, not default

---

## Generation Model — Generative-First, Curated Core

**Small curated component library (15-25 primitives)** for things that must be reliable: data tables with sorting/filtering, charts, action buttons, form inputs, flow builder (React Flow or similar).

**Fully generative for everything else.** The AI writes the HTML/CSS/JS for layout, arrangement, custom visualizations, contextual pieces. No massive component library needed. The skill encodes the design rules; the AI follows them and generates the code.

**Source design tokens.** Each source can have its own visual language (color scheme, typography, card style) extracted from screenshots of the native app. Components accept tokens as parameters. Xero data renders in Xero-flavored styling. Plunet data renders in Plunet-flavored styling. Cross-source views use the platform's default tokens. Tokens are evocative, not identical — similar feel to the source, not pixel-perfect brand copying.

---

## Agents and the View Builder

The view-builder is driven by agents, not by the user directly (though the user steers):

**ToM** — the user's personal agent. Curates the home surface, decides card weights and priorities, translates views into the user's vocabulary. When the user asks "show me my invoices," ToM decides which view type, which emphasis, which data to pull.

**Tim** — the team agent for shared spaces. Curates the shared surface, decides what's relevant to the team context.

**Functional agents** (Libby, Denise, etc.) — can generate views relevant to their domain. Libby might generate a "knowledge gaps" briefing. Denise might generate a design review flow.

**Background agents** — monitor view quality, flag stale data, suggest view improvements.

The agent interaction model in the dock: you can pull in any agent, add real users, add sources, and they collaborate in the thread. This thread can also drive view generation — "ToM, show me what Libby thinks needs updating" generates a view right in the dock conversation, which can then be expanded onto the surface.

---

## Build Engine Options

### Option A — Third-party (v0 Platform API)

v0's headless API generates React/Next.js code from prompts. Agent translates spec → v0 prompt → code files. Good for complex custom layouts.

### Option B — Own renderer (current prototype)

Custom component library + AI-generated layouts. Agent produces component tree, renderer outputs HTML. Full control, no dependency.

### Option C — Hybrid (recommended for Month 1-2)

Own renderer for prototyping. Spec format is engine-agnostic so v0 can be added later. Build the intelligence first, swap the renderer when ready.

### Option D — MCP Apps (recommended target for Month 3+)

Use MCP Apps protocol as the delivery mechanism. Views are HTML bundles served by an MCP server, rendered in a sandboxed iframe. Bidirectional communication via SDK. Works in Claude, ChatGPT, VS Code, and your own platform.

**Multi-surface rendering (enabled by abstract spec):**

```
Spec (stored in Supabase)
  → MCP Apps renderer → HTML bundle → Claude / ChatGPT / platform / VS Code
  → WhatsApp renderer → text + interactive buttons → WhatsApp bot
  → Email renderer → HTML email → morning digest / surface mail
  → Murmur renderer → one-line summary → murmur layer
  → Card renderer → weighted card with context → home surface
```

---

## The Shell

**Phase 1 (Month 1-2): Custom shell**

Three-layer platform architecture: murmur layer (top), surface (center), dock (bottom). Generated views render on the surface. Dock provides the Steer loop. Shell handles auth, data subscriptions, action routing, state persistence, invalidation.

**Phase 2 (Month 3+): MCP Apps as shell**

Embedding, sandboxing, and bidirectional communication handled by MCP Apps protocol. Platform becomes an MCP Apps host. Composed mode: multiple MCP App iframes on the surface, each independently interactive. Data layer and business logic stay in the MCP server.

---

## The Steer Loop (via the Dock)

The dock IS the Steer interface. No separate right-rail chat needed — the dock is always present, always contextual.

**Three types of input, routed to different layers:**
1. **Ephemeral filter** — "show only invoices over $5k" → view filter, no spec change
2. **Layout/content change** — "move the chart to the top" → spec update → rebuild
3. **Persistent preference** — "this client is important" → ToM update → affects all future views

**Context-aware:** the dock knows which card or view the user is focused on. Steer input automatically targets the active view. Multi-thread: interruptions create new threads, never hijack existing ones.

---

## Skills

### View-type skills (Issac's scope):

| # | Skill | Status |
|---|-------|--------|
| 1 | Spatial View | Rough version in page-composer. Needs SKILL.md formalization. |
| 2 | Sequential View | Not started. Next priority after Steer loop. |
| 3 | Briefing View | Queued. Needs multiple sources. |
| 4 | Weighted Card View | Not started. Needed for home surface. |
| 5 | Configuration View | Not started. Needed for source config and flow board. |

### Pipeline skills (Issac's scope):

| # | Skill | Status |
|---|-------|--------|
| 6 | Spec Composition | Rough version. Needs semantic understanding, not just data shape. |
| 7 | Data Analysis | Primitive version. Needs to go from structural to semantic. |
| 8 | Connector Abstraction | Not started. Needs interface design. |
| 9 | Spec Validation | Primitive version. Needs SKILL.md formalization. |
| 10 | Eval | Not started. |

### Platform skills (not Issac's scope, listed for visibility):

| # | Skill | Owner |
|---|-------|-------|
| 11 | retrieve_for_query | Platform team |
| 12 | misfit_handler | Platform team |
| 13 | translation | Platform team |
| 14 | topical_page_generation | Platform team |
| 15 | promotion | Platform team |

---

## Bootstrapping Sequence

**Month 1 — One source, end to end:**
1. Pick the source with the cleanest API
2. Build the agent skill for that source (hardcode ontology for now)
3. Build minimal own renderer with 15 core primitives
4. Build minimal shell: surface + dock + one data connector
5. Get a working generated spatial view with live data

**Month 2 — Multi-view + Steer + sequential:**
1. Implement view collection model (tabs, add/rename/delete)
2. Connect dock as Steer interface → spec → rebuild pipeline
3. Three-way routing (filter / spec change / ToM log)
4. Build Sequential View skill + primitives
5. Add second source to prove generalization
6. Action routing (write-back to source)
7. Save/load views (fixed vs. generated)

**Month 3 — MCP Apps + home surface + multi-surface:**
1. MCP Apps proof of concept: one view served as MCP App
2. Migrate renderer to produce MCP Apps HTML bundles
3. Platform as MCP Apps host with composed mode
4. Build Weighted Card View skill for home surface
5. Build Configuration View skill for source config + flow board
6. Source design tokens (visual theming per source)
7. Multi-surface exploration: same spec → WhatsApp, email

---

## What Success Looks Like

- User opens the platform. Home surface shows weighted cards curated by ToM. No loading, no empty state — ToM always has something ready.
- User taps a card. It expands in place with generated UI. They act on it. The card updates. The source updates.
- User opens dock, says "show me aging receivables by client." A view generates on the surface. They say "save this." It becomes a fixed view.
- User says "add another view as a kanban board." New tab appears. Both views stay live.
- User says "walk me through the 5 emails that need attention." A sequential flow generates — one at a time, action buttons, progress bar.
- Colleague opens the same source. Different default view because different ToM.
- Same spec renders as an MCP App in Claude, as a WhatsApp message with buttons, as an email digest.
- User opens source config. Flow board shows data flowing between sources. User drags a block to redirect invoice routing. Presses Authorize. Flow updates.

---

## Open Questions

1. **First-view quality bar** — how good does the auto-generated default need to be before users trust the system?
2. **Component format commitment** — React for MCP Apps HTML bundles, or framework-agnostic?
3. **Offline/degraded states** — stale data with indicator, or visible failure?
4. **View limits** — max views per source? Practical ceiling for composed mode?
5. **Cross-source composed views** — view-builder feature or Spaces feature?
6. **Generation cost model** — token budget per generation? Batch changes vs. regenerate per Steer message?
7. **View templates** — pre-built starting points per source type?
8. **Card weight algorithm** — how does ToM compute priority for the home surface? What signals?
9. **Team lens** — when viewing a shared space, how does ToM + Tim collaboration produce the team surface?
10. **Legal — source design tokens** — how close to the source's brand identity is acceptable? Evocative vs. identical.
