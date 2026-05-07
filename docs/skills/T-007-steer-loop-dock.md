# T-007 — Steer Loop Integration via Dock

**Wave:** 2 — Core Loop  
**Estimate:** 1.5 days  
**Depends on:** T-003, T-005  
**Blocks:** T-017 (MCP Apps work assumes Steer is functional)

---

## Context

The Steer loop is the core interaction model. The user types something in the chat ("move the chart to the top," "show only invoices over $5k," "this client is important") and the system routes the input to the right layer:

- **Ephemeral filter** — applies a filter to the current view, no spec change
- **Layout/content change** — updates the saved spec, regenerates the relevant parts
- **Persistent preference** — logs to the ToM layer (we'll wire this fully later; for now, just log)

The chat lives in the **dock** (always present at the bottom of the screen). It's context-aware — if the user is looking at a specific view, Steer messages target that view automatically.

---

## Scope

Build the dock chat UI. Wire it to the agent. Implement the three-way routing. Show streaming progress during regeneration. Maintain conversation history per thread.

---

## Deliverables

1. Dock UI: persistent chat bar at the bottom, expandable upward
2. Message routing logic: classify intent, route to the right handler
3. Filter handler: ephemeral, no spec change
4. Spec change handler: update spec via T-005's save flow
5. Preference handler: log to a `tom_log` table for now (full ToM integration later)
6. Streaming progress UI when regeneration is happening
7. Conversation history persisted per thread

---

## Routing Logic

The agent classifies each Steer message into one of three buckets. Use a small classification prompt:

```
The user said: "[message]"
Current view: [view name and type]
Current view's spec summary: [brief summary]

Classify the intent:
1. EPHEMERAL_FILTER — user wants to filter/sort the visible data without changing the saved layout
2. SPEC_CHANGE — user wants to modify the layout, add/remove components, change emphasis
3. PERSISTENT_PREFERENCE — user is expressing a general preference about themselves or what matters

Return JSON: { "intent": "...", "rationale": "..." }
```

### Filter handler
- Update the view's filter state in client memory (or a `view_state` table for persistence across sessions, optional)
- The view re-renders with the filter applied
- No call to AI generation
- No change to saved spec

### Spec change handler
- Agent generates a new spec (or a patch) based on the user's instruction
- Show streaming progress in the dock while this happens
- Update the saved view's spec via T-005
- The view re-renders
- Add an entry to conversation history: "Updated layout: [change description]"

### Preference handler
- Log to `tom_log` table with: user_id, preference_text, context (current view, current source), timestamp
- Acknowledge in the dock: "Got it, I'll remember that."
- (Full ToM integration is future work — this is just the entry point)

---

## Dock UI Spec

- **Collapsed state**: thin bar at the bottom, ~40px tall, with a placeholder "Ask, tune, or trigger…"
- **Active state**: expands upward to ~30-40% of screen height
- **Conversation visible**: scrollable history above the input
- **Input**: text area with send button, supports Enter to send / Shift-Enter for newline
- **Streaming**: when regeneration is in progress, show a streaming indicator with rough progress text ("Updating layout… moving chart…")
- **Context tag**: at the top of the dock, show what the conversation is scoped to ("About: [Source name] / [View name]")

When the user navigates between views or sources, the active dock thread changes context. Previous threads are preserved (multi-thread support is in scope for the next ticket; for now, just one active thread per view).

---

## Acceptance Criteria

- [ ] Dock UI present at bottom of screen, expandable
- [ ] Message classification works: test with 5+ examples per intent type
- [ ] Filter handler: filter applied without AI call (verify by checking logs — no OpenRouter request)
- [ ] Spec change handler: AI generates new spec, view re-renders, version added to `view_versions`
- [ ] Streaming progress shown during regeneration (not just a spinner — actual progress text)
- [ ] Preference handler: entry written to `tom_log` table with all required fields
- [ ] Conversation history persisted (not lost on page refresh) — store per-view in Supabase
- [ ] Context tag updates when user navigates to a different view
- [ ] Dock state (collapsed/expanded) persists across page navigations
- [ ] Test with 10+ real Steer interactions to confirm classification accuracy ≥ 80%

---

## Notes for the Agent

- Don't build multi-thread support yet (one active thread per view is enough for v1). T-008 will add multi-view tabs which forces multi-thread.
- Don't build agent initiation yet (agent reaching out to user) — that's a future ticket.
- Don't try to make the dock work as an MCP App or as a separate widget — it's a normal UI component for now. MCP Apps integration is T-017.
- Use streaming SSE (already implemented in the prototype) for the regeneration progress.
- If the classification is wrong on a given message, the user should be able to correct it: "no, I meant change the layout, not filter" — log this as a signal for future classifier improvement, but don't build a learning loop yet.
