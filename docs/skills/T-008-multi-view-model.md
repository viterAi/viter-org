# T-008 — Multi-View Model: Tabs, Add, Rename, Delete

**Wave:** 2 — Core Loop  
**Estimate:** 1 day  
**Depends on:** T-005  
**Blocks:** Composed mode work in T-018+

---

## Context

A single source can have multiple views. A user might want their Xero source to have:
- An "Aging Overview" dashboard (spatial)
- A "Triage" sequential view for invoices needing attention
- A "Pipeline" board view

Each view is independent — its own spec, its own steer history, its own state — but they share the underlying data and connectors.

This ticket implements the view collection per source and the UI for managing it.

---

## Scope

Build the view collection model. Add tab UI for switching between views. Implement add/rename/delete/duplicate/set-default. Each view gets its own dock thread (multi-thread support).

---

## Deliverables

1. Tab UI in the source header showing all views
2. "Add View" button that triggers generation with a prompt for what kind of view
3. View management actions: rename (inline edit on tab), delete (with confirmation), duplicate, set as default
4. Multi-thread dock: switching views switches the dock context to that view's thread
5. Default view logic: opening a source loads the default view (first view if no explicit default set)

---

## Behavior Spec

### Adding a view
- User clicks "+ Add View" in the source's view tab bar
- Modal or inline prompt: "What kind of view?" with options or free text
- User describes the view (or picks a template)
- Agent generates a spec, saves it as a new view (status='draft')
- Tab appears in the bar, view becomes active
- User can refine via dock, then save

### Renaming
- Double-click a tab → inline edit
- Or right-click → context menu → Rename
- Enter to confirm, Esc to cancel
- View's `name` field is updated in Supabase

### Deleting
- Right-click a tab → Delete
- Confirmation: "Delete '[view name]'? This cannot be undone."
- View is hard-deleted (or soft-deleted with `status='archived'` — pick one and document)
- If the deleted view was the default, the next view in order becomes default
- If it was the last view, source goes back to "no views" state

### Duplicating
- Right-click a tab → Duplicate
- Copies the spec exactly to a new view named "[Original name] (copy)"
- New view is a draft until user saves explicitly

### Setting default
- Right-click a tab → Set as default
- Updates `is_default = true` on this view, `false` on all others for this source
- When source is opened next, this view loads first

### Switching between views
- User clicks a tab → that view loads
- Dock context switches: the conversation history for that view's thread becomes active
- Previously active view's thread is preserved but hidden

---

## Multi-Thread Dock

The dock now needs to maintain a separate conversation thread per view:

```typescript
interface DockThread {
  view_id: string;
  messages: Message[];
  created_at: string;
}
```

- When the user switches views, the dock loads that view's thread
- New messages are appended to the active view's thread
- If the user switches away mid-typing, the draft message is preserved with the original thread

---

## Acceptance Criteria

- [ ] Tab UI renders all views for the current source
- [ ] "+ Add View" button works: opens prompt, generates view, adds tab
- [ ] Inline rename works (double-click tab → edit → Enter)
- [ ] Delete works with confirmation
- [ ] Duplicate works: creates a new view with the same spec
- [ ] Set as default works: persisted in `views.is_default`
- [ ] Opening a source loads the default view (or first view if no default)
- [ ] Dock thread switches when user switches views — verify with messages in different views
- [ ] Draft messages preserved when switching views
- [ ] Drag-and-drop reorder works (tabs can be dragged left/right; order persisted in `views.position` field)
- [ ] If a source has zero views, an empty state shows with a single "Generate your first view" button

---

## Notes for the Agent

- Add a `position` integer column to `views` for drag-reorder. Default to highest existing position + 1 on insert.
- Use a small library like `@dnd-kit/core` for drag-and-drop. Don't build it from scratch.
- The "Add View" prompt could be as simple as a text input + a few suggested view types as buttons ("Dashboard," "Triage queue," "Project board"). Don't over-design.
- Tab overflow: if there are too many tabs to fit, add horizontal scrolling or an overflow dropdown. Don't wrap tabs to multiple rows.
- This ticket doesn't include composed mode (multiple views visible at once). That's later.
