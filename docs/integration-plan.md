# View Builder — Platform Integration Plan

**Author:** Issac Brown  
**Last updated:** May 7, 2026  
**Status:** Draft — pending review and sign-off from Mrodchi  
**Blocks:** checklist items 1.4, 1.5 ⚡

---

## Purpose

This document defines how the View Builder integrates with the broader platform. It is a shared contract between the View Builder (Issac) and Mrodchi's server (platform data + intelligence layer). Both sides must agree on this before either side builds against the interface.

---

## What the View Builder Is (and Isn't)

The View Builder is a **pure rendering layer**. It receives data and intent, generates a view spec, and renders it. It does not own auth, data collection, user intelligence, or agent memory.

Everything else — auth, data ingestion, surfacing logic, ToM, agent memory — is owned by Mrodchi's server.

---

## Platform Architecture

The platform has three permanent layers. The View Builder produces output for the **surface** layer only.

```
┌─────────────────────────────────────────┐
│  Murmur (top)                           │  ← ambient stream, ToM-curated
│  one-line summaries / counts / alerts   │
├─────────────────────────────────────────┤
│  Surface (center)                       │  ← VIEW BUILDER OUTPUT LIVES HERE
│  generated views, weighted cards        │
├─────────────────────────────────────────┤
│  Dock (bottom)                          │  ← Mrodchi owns this
│  conversational layer, always present   │
└─────────────────────────────────────────┘
```

---

## Ownership Boundaries

| Concern | Owner |
|---------|-------|
| Shell chrome (murmur / surface / dock layout) | Platform shell |
| Auth, user identity, permissions | Platform shell / Mrodchi |
| Data ingestion, source connectors | Mrodchi's server |
| User intelligence, ToM, preferences | Mrodchi's server |
| Dock chat UI | Platform shell |
| Deciding view type + intent from user message | Mrodchi |
| Spec composition (how to render a view) | View Builder |
| Component library, skills, rendering rules | View Builder |
| Spec storage and versioning | View Builder (Supabase `views` table) |
| Spec schema and format | View Builder owns the view layer; data field schema is a shared contract |

---

## Data Flow

### How data reaches the View Builder

1. Mrodchi's server (or a Supabase Edge Function it controls) writes source data to a Supabase table
2. The View Builder reads from that table when generating or refreshing a view
3. The View Builder never fetches data directly from source systems — all data arrives via Supabase

### The data handshake (hypothesis — to be confirmed with Mrodchi's team)

When Mrodchi triggers a new view, it passes:

```json
{
  "intent": "show aging receivables by client",
  "view_type": "spatial",
  "data": {
    "index": "markdown description: what this data is, what to do with it, field meanings",
    "sources": [
      { "type": "markdown", "content": "..." },
      { "type": "file_path", "path": "/path/to/data.csv" }
    ]
  }
}
```

- `intent` — natural language description of what the user wants
- `view_type` — Mrodchi decides this based on user context and ToM (`spatial` / `sequential` / `briefing` / `weighted_card` / `config`)
- `data.index` — markdown description of what the data means (semantic, not just structural)
- `data.sources` — array of data sources: inline markdown blocks or file paths to fetch

**This format is a working hypothesis. Final schema to be agreed with Mrodchi's team.**

---

## View Generation Flow

### Case 1 — No saved spec (first time)

```
User opens source / requests view
  → Mrodchi: understands intent + context → picks view_type → sends handshake payload
  → View Builder: receives payload → composes spec using view-type skill → renders
  → Surface: displays view (ephemeral — not saved yet)
  → User: steers or says "save this"
  → View Builder: writes spec to Supabase views table
```

### Case 2 — Saved spec exists

```
User opens source
  → View Builder: loads spec from Supabase views table
  → View Builder: fetches fresh data via Supabase
  → Surface: renders (no AI call, no Mrodchi involvement)
```

---

## Steer Loop (View Refinement)

When the user modifies a view via the dock, message routing splits three ways:

| Message type | Example | Handler |
|---|---|---|
| Pure UI change | "move the chart to the top" | View Builder handles directly — no external call |
| Needs data | "show only overdue invoices" | View Builder calls Mrodchi's MCP data agent → gets data → re-renders |
| Persistent preference | "this client is important" | Mrodchi handles — updates ToM, affects future views |

The dock sends all messages to Mrodchi first. Mrodchi classifies and routes:
- View-change without data → passes to View Builder as a spec-update instruction
- View-change needing data → fetches data, then passes to View Builder with updated payload
- Preference → handles internally, may or may not trigger a view update

---

## Spec Persistence

- Generated views are **ephemeral by default**
- User must explicitly say "save this" to persist
- On save: View Builder writes spec to `views` table in Supabase
- Each subsequent Steer change that modifies the layout creates a new version entry
- User can roll back to a previous version

---

## Action Routing (OPEN — to be decided)

When a user takes an action inside a generated view (clicks a button, submits a form), routing is TBD:

| Action type | Candidate handler | Notes |
|---|---|---|
| Ephemeral filter / UI-only | View Builder (in-memory) | No external call needed |
| Persistent write-back to source | Supabase events table? Direct to Mrodchi? | To be decided |
| Agent-triggering action | MCP server call? | To be decided |

**This needs a joint decision with Mrodchi's team before write-back is implemented.**

---

## What Stays Local Until This Plan Is Approved

- The app runs locally only — no Railway deployment (already taken offline ✓)
- No new source connectors built until data handshake schema is confirmed
- No write-back implementation until action routing is decided

---

## Open Questions (Require Mrodchi's Team Input)

1. **Data handshake schema** — confirm or revise the `{ intent, view_type, data }` structure
2. **Action routing** — how do persistent write-back and agent-triggering actions get routed?
3. **Edge Function ownership** — who maintains the Supabase Edge Function that serves data to the View Builder?
4. **View type decision** — does Mrodchi always decide `view_type`, or can the View Builder suggest one if Mrodchi doesn't specify?
5. **MCP data agent interface** — what does the View Builder call, with what arguments, when it needs additional data mid-steer?

---

## Next Steps

- [ ] Share this doc with Mrodchi's team for review
- [ ] Resolve open questions (joint session)
- [ ] Confirm data handshake schema
- [ ] Finalize action routing decision
- [ ] Mark integration plan approved → unblocks spec format work and shell build
