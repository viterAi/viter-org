# T-020 — Configuration View Skill (Source Config + Flow Board)

**Wave:** 5 — Month 3+  
**Estimate:** 2 days  
**Depends on:** T-014 (template), T-006 (connector abstraction)  
**Blocks:** Source config + flow board functional

---

## Context

Configuration views are a different beast from data views. The user is in *setup mode*, not consumption mode. They're defining how things work: which data matters from a source, how information flows, what permissions apply, what to authorize.

These views use the **hybrid fixed+dynamic pattern**: stable layout, interactive components the user manipulates (drag-and-drop blocks, toggle permissions, connect flow paths), with an **authorize/confirm action** that commits changes back to the system.

Examples: source configuration surface, the visual flow board, permissions setup, agent configuration.

---

## Scope

Research configuration UX patterns. Write the SKILL.md. Build the flow builder primitive (using React Flow or similar). Implement source config and flow board as concrete examples.

---

## Deliverables

1. `skills/configuration-view/SKILL.md`
2. New primitives: `flow-builder.tsx`, `permission-grid.tsx`, `authorize-bar.tsx`
3. Two example configurations: source config view, flow board view
4. Eval cases (3) for configuration view generation
5. Working source config surface for at least one source (using Local connector)

---

## Required Reading

- React Flow (xyflow.com) — the de facto library for node-based UIs
- Zapier's flow builder UX
- Permission management patterns: GitHub's, Google Drive's, Notion's
- Setup wizard patterns (already covered in T-014; reuse those rules)

---

## Required Rules in Configuration View SKILL.md

### Hybrid fixed/dynamic pattern
- Layout structure is stable (sections, headings, organization)
- Interactive components within (blocks, connections, toggles) are dynamic — user manipulates them, system reflects
- Changes are NOT auto-committed — user must explicitly authorize

### Authorize/confirm pattern
- Every config view ends with an authorize bar at the bottom
- Authorize bar shows: summary of pending changes, "Save", "Cancel", optional "Reset to defaults"
- Pending changes are visually marked (e.g., yellow indicators on changed components)
- Save commits the changes; Cancel reverts; Reset returns to defaults

### Visual feedback rules
- Changes are immediately visible in the UI (the flow board updates as the user drags)
- But the *commit* is explicit (Authorize button)
- Until authorized, the system shows "uncommitted changes" indicator

### Direct manipulation rules
- For block-based UIs (flow board): drag-and-drop, snap to grid, visual connection lines
- For permission grids: toggle switches, immediate visual update
- For lists: drag-to-reorder

### Undo rules
- Configuration changes support Undo (Cmd-Z) until authorized
- Once authorized, undo requires going through version history (per T-005)

---

## New Primitives

### `FlowBuilder`

```typescript
interface FlowBuilderProps {
  nodes: FlowNode[];           // blocks (sources, agents, users, transformations)
  edges: FlowEdge[];           // connections between blocks
  available_node_types: NodeType[];  // what can be added
  on_change: (nodes, edges) => void;  // called on every change
  read_only: boolean;
  tokens?: DesignTokens;
}
```

Built on React Flow. Custom node renderers for: source (database icon), agent (avatar icon), user (person icon), transformation (gear icon). Connections are typed (data flow vs. notification flow).

### `PermissionGrid`

```typescript
interface PermissionGridProps {
  subjects: Subject[];         // people/agents being granted permissions
  resources: Resource[];       // what they have access to
  permissions: PermissionMatrix;  // current state
  on_change: (matrix) => void;
  read_only: boolean;
  tokens?: DesignTokens;
}
```

Renders as a grid: subjects on rows, resources on columns, cells show read/write/delete toggles.

### `AuthorizeBar`

```typescript
interface AuthorizeBarProps {
  pending_changes: ChangeDescription[];  // list of what will change
  on_save: () => Promise<void>;
  on_cancel: () => void;
  on_reset?: () => void;
  tokens?: DesignTokens;
}
```

Sticky bar at the bottom of the view. Shows pending changes ("3 connections added, 1 permission changed"). Save button is disabled until at least one change exists.

---

## Source Config View

Concrete example of a configuration view: the surface where users configure a connected source.

Sections:
1. **Identity** — source name, icon, type
2. **What matters** — checkboxes/tags for entity types and fields the user cares about (feeds ToM)
3. **Permissions** — per-user, per-entity-type, read/write/delete (uses PermissionGrid)
4. **Flow connections** — outgoing data flows ("invoices flow to: Finance space, Sarah, Finance Agent")
5. **Authorize bar** at the bottom

---

## Flow Board View

Concrete example: a visual representation of how information flows across the platform.

Layout:
- Full-canvas FlowBuilder
- Side panel listing available block types (sources, agents, users, transformations)
- Top toolbar: zoom, fit-to-screen, layout-auto, save
- Authorize bar at the bottom

User can:
- Drag blocks from the side panel onto the canvas
- Connect blocks with arrows
- Click a block to configure it (opens a side panel)
- Click an arrow to configure the data filter on that connection

---

## Acceptance Criteria

- [ ] `skills/configuration-view/SKILL.md` complete with all rules
- [ ] Three primitives implemented: FlowBuilder, PermissionGrid, AuthorizeBar
- [ ] All accept design tokens
- [ ] FlowBuilder uses React Flow internally
- [ ] AuthorizeBar shows pending changes and disables save when no changes
- [ ] Source config view works end-to-end: user can edit, see pending changes, authorize, see changes persisted
- [ ] Flow board view works end-to-end: user can add/remove blocks, draw connections, authorize
- [ ] Two example specs in `skills/configuration-view/examples/`
- [ ] 3 eval cases produce baseline scores
- [ ] Undo works (Cmd-Z) until authorize is pressed

---

## Notes for the Agent

- React Flow is the right library here — don't reinvent the wheel.
- The "pending changes" tracking is critical. Implement it as a diff between the current saved state and the in-memory state.
- For the flow board, the "blocks" are abstract — sources, agents, users, transformations. The skill defines what these are at the abstract level; the renderer uses appropriate icons.
- Don't try to make the flow board execute anything yet (no actual data routing). It's a configuration surface — once authorized, it updates the routing config that the platform uses elsewhere.
- This is the most complex view type so far. Plan time accordingly.
