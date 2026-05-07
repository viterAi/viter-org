# T-019 — Weighted Card View Skill (Home Surface)

**Wave:** 5 — Month 3+  
**Estimate:** 1.5 days  
**Depends on:** T-014 (template), T-004 (tokens)  
**Blocks:** Home surface launch

---

## Context

The home surface (the user's "OS") uses a different view type than dashboards or triage queues. It's a **weighted card view**: ToM-curated cards, sized and positioned by priority, expandable in place (glance → engage → immerse), with each card showing enough context to decide without opening it.

This is not a dashboard. It's a cognitive triage surface. It's how the user sees what matters to them right now, across all sources, all spaces, all open loops.

---

## Scope

Research weighted card / cognitive triage patterns. Write the SKILL.md. Build the primitives needed (weighted card, expandable card stack). Wire up ToM card-weight computation.

---

## Deliverables

1. `skills/weighted-card-view/SKILL.md` — the skill document
2. New primitives: `weighted-card.tsx`, `card-stack.tsx`, `expandable-card.tsx`
3. ToM integration: agent computes card weights from open loops + ontology + user preferences
4. Two example specs in `skills/weighted-card-view/examples/`
5. Eval cases (3) for weighted card generation

---

## Required Reading

- Inbox Zero / triage patterns: research how Superhuman, Hey, and Linear surface "what to act on next"
- Priority-driven layout: how does Apple's Dynamic Island prioritize information?
- Progressive disclosure for cards: NN Group on card UI patterns
- Cognitive triage: Edward Hallowell on attention allocation (broad context, not specific UX)

---

## Required Rules in Weighted Card View SKILL.md

### Card content rules
- Each card must show enough context to decide without opening it
- Bad: "Invoices: 3"
- Good: "3 invoices from Acme need approval — $14k total, due Friday"
- Required elements per card: subject (what is it?), context (why does it matter?), recommended action

### Weighting rules
- Cards are sized and positioned by priority as ToM understands it
- Largest, top-left: most urgent and important
- Smaller, lower: awareness items
- Stale items (no engagement, low priority over time) fade — reduced opacity, smaller size, or hidden behind a "show more" toggle
- Maximum ~7 prominent cards visible (working memory limit); rest are accessible but not in the primary scan path

### Spatial stability rules
- Cards do NOT reshuffle while the user is looking at them
- Recalculation happens on open or refresh, not in real time
- The user can pin a card to keep it in place
- When a card is acted upon (resolved, dismissed), it animates out — neighbors slide to fill, but other cards' positions don't shuffle

### Progressive disclosure rules
- Three levels:
  - **Glance** — card view (default)
  - **Engage** — card expands in place to show generated UI + dock thread
  - **Immerse** — full-screen focused mode for deep work
- Tapping a card moves to engage; tapping a "focus" affordance moves to immerse
- Closing returns to the previous level

### Weight computation rules (handled by ToM, surfaced in SKILL.md)

ToM computes a weight for each candidate card based on:
- Recency of relevant change
- User-stated importance (preferences logged in tom_log)
- Open loops (unanswered emails, pending decisions)
- Time-sensitivity (deadlines, due dates)
- Ontological importance (high-priority entities per the source's salience map)

The skill defines the OUTPUT format (cards with weight scores 0-100), not the algorithm for computing weights.

---

## New Primitives

### `WeightedCard`

```typescript
interface WeightedCardProps {
  subject: string;              // what is it?
  context: string;              // why does it matter?
  recommended_action?: string;  // suggested next step
  weight: number;               // 0-100, drives sizing
  stale: boolean;               // reduced visual prominence
  pinned: boolean;
  on_engage: () => void;
  on_pin: () => void;
  on_dismiss: () => void;
  tokens?: DesignTokens;
}
```

Renders as a card whose size is proportional to weight. Pinned cards have a visual indicator. Stale cards have reduced opacity.

### `CardStack`

```typescript
interface CardStackProps {
  cards: WeightedCardData[];
  layout: 'grid' | 'masonry';
  on_card_engage: (card_id: string) => void;
  tokens?: DesignTokens;
}
```

Arranges weighted cards by priority. Handles "show stale" toggle. Animates card removal when dismissed.

### `ExpandableCard`

A card that can transition between glance / engage / immerse states. Wraps `WeightedCard` and adds the expansion behavior.

---

## ToM Integration

The agent that generates the home surface (let's call it the "home composer") needs:

1. Access to ToM's understanding of the user (preferences, recent activity, current focus)
2. Access to the ontology (entity importance, salience maps)
3. Access to the wiki (open loops, stale items)
4. Access to all sources (cross-source synthesis)

The output is a list of weighted cards ranked by priority. The skill ensures each card meets the content rules (enough context to decide, etc.).

For now, ToM is partially stubbed: hardcode the weighting algorithm (e.g., recency × importance × open_loop_count). Full ToM integration is platform-level work.

---

## Acceptance Criteria

- [ ] `skills/weighted-card-view/SKILL.md` exists with all rules
- [ ] Three primitives implemented (WeightedCard, CardStack, ExpandableCard)
- [ ] All accept design tokens
- [ ] Card sizing is proportional to weight (visually distinct sizes for high vs. low weight)
- [ ] Card stack supports pin and dismiss with animations
- [ ] Three-level progressive disclosure works: glance → engage → immerse
- [ ] Generation pipeline produces valid weighted card view specs from a sample data + ToM context
- [ ] Two example specs in `skills/weighted-card-view/examples/`
- [ ] 3 eval cases produce baseline scores
- [ ] Stable spatial layout: dismissing a card animates neighbors but doesn't reshuffle the entire layout

---

## Notes for the Agent

- This is a more advanced skill than Spatial or Sequential. Read the references; don't wing it.
- The "weight" parameter is abstract — the skill doesn't define exactly how to compute it. That's ToM's job. The skill defines what to do with the result.
- Card content quality is everything. Spend time on the "context per card" rules and examples — that's where users will judge the system.
- Use Framer Motion for the animations (pin, dismiss, expand). They need to feel fluid.
- If a card has weight 0 (no priority), it should NOT be in the spec at all. Filtering happens at the spec composition layer.
