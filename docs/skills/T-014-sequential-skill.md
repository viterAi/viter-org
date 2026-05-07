# T-014 — Research & Write Sequential View Skill

**Wave:** 4 — Sequential Views  
**Estimate:** 1 day  
**Depends on:** T-010 (template established)  
**Blocks:** T-015, T-016

---

## Context

Sequential views are one of the three core view types: triage queues, wizards, approval flows, checklists, onboarding sequences, handoffs. The user is in *decision mode* — processing one item at a time and advancing.

This is a different cognitive model than spatial dashboards. Spatial views are about scanning and comparing; sequential views are about deciding and progressing. The design rules are different. The interaction patterns are different. The success criteria are different.

This ticket researches the best practices and produces the SKILL.md that will guide generation.

---

## Scope

Research sequential view design (1–2 hours of focused reading from the references). Distill into rules. Write the SKILL.md following the template from T-010.

---

## Deliverables

1. `skills/sequential-view/SKILL.md` with explicit rules
2. Validator (`lib/skills/sequential-view-validator.ts`) that checks specs against the rules
3. Two example specs in `skills/sequential-view/examples/`
4. Two anti-pattern specs in `skills/sequential-view/anti-patterns/`
5. Skill index entry updated (T-011)

---

## Required Reading

Read these before writing the skill (skim the relevant sections, don't read everything):

1. **Nielsen Norman Group on progressive disclosure** — nngroup.com/articles/progressive-disclosure
2. **Lollypop Design's wizard patterns** — lollypop.design/blog/2026/january/wizard-ui-design (Airbnb, Duolingo, Blazeup case studies)
3. **Eleken's wizard UI guide** — eleken.co/blog-posts/wizard-ui-pattern-explained
4. **Sweller's Cognitive Load Theory** — Wikipedia article is sufficient for the practical points
5. **Userpilot on progressive disclosure examples** — userpilot.com/blog/progressive-disclosure-examples

---

## Required Rules in the Sequential View SKILL.md

The skill must encode at minimum these rules:

### Cognitive load rules
- Show ONLY what's needed for the current decision — defer everything else
- Each step should feel completable; the user knows when they're done with this item
- Working memory limit: ~7 things at a time, fewer if any are complex

### Decision interface rules
- 2–4 action buttons maximum (Hick's Law — more options = longer decision time)
- Buttons have clear, distinct labels (not "Yes / No" but "Approve / Reject / Need more info")
- Primary action visually distinct from secondary
- Destructive actions (Delete, Archive, Reject) require either confirmation or clear visual differentiation

### Progress rules
- User must always know where they are in the queue: "3 of 7" or progress bar
- Items already processed should be subtly indicated (so the user can review what they did)
- Estimated time remaining when feasible

### Momentum rules
- Each completed action should feel like progress
- Micro-interactions: card slides away, counter decrements, success indicator
- Don't pause unnecessarily between items
- Auto-advance to next item after a decision (unless the user opts out)

### Context scaffolding rules
- For each item, show just enough context to decide
- Email triage: sender, subject, first 2 lines, project context
- Invoice approval: amount, vendor, days outstanding, related notes
- Each entity type has its own "decision context" — the skill must define what's needed

### Escape hatch rules
- "Skip" / "Save for later" / "I need more info" — always available
- Forced linearity creates anxiety; allow detours
- "Quit" (exit the sequence) should be possible from any step

### Completion rules
- Sequence end shows a summary: "You processed 5 emails: 2 replied, 2 archived, 1 escalated"
- Completion provides closure — empty state with positive framing ("You're all caught up")
- Option to review what was done

### Anti-patterns
- Showing all items in a list — that's a spatial view, not sequential
- 8 action buttons per item — decision paralysis
- No progress indicator — feels unbounded
- Jumping items around between visits — disorienting
- No escape from the sequence — feels like a trap

---

## Sequential View Spec Node Types

The spec format from T-003 already defines `single_item_focus` and `action_bar`. The Sequential View skill uses these plus:

- `sequence_controller` — meta-component that manages the queue (which items, in what order, position tracking)
- `briefing_intro` — opening screen ("You have 5 emails to triage")
- `completion_summary` — closing screen ("Processed 5: 2 replied, 2 archived, 1 escalated")
- `progress_indicator` — bar or counter showing position in queue

These will be implemented as primitives in T-015. For now, the SKILL.md just references them.

---

## Acceptance Criteria

- [ ] `skills/sequential-view/SKILL.md` exists with all rules above
- [ ] YAML frontmatter present (status, purpose, etc.) per T-011 format
- [ ] Each rule is enforceable (a programmatic check could be written)
- [ ] References section cites NN Group, Lollypop, Sweller, Userpilot
- [ ] Validator (`lib/skills/sequential-view-validator.ts`) checks specs against the rules
- [ ] Two example specs in `skills/sequential-view/examples/`:
  - `email-triage.json` — email triage queue
  - `invoice-approval.json` — approval flow
- [ ] Two anti-pattern specs:
  - `too-many-buttons.json` — violates Hick's Law
  - `no-progress.json` — missing progress indicator
- [ ] Skill registered in the skill index (T-011)

---

## Notes for the Agent

- Don't skip the reading. The quality of the skill depends on the depth of the research.
- When in doubt, choose the simpler rule. "≤4 buttons" beats "consider context-dependent button limits."
- The skill should explicitly cover: triage queues, approval flows, onboarding wizards, checklists from PRDs, handoff sequences. These are all variants of the same pattern.
- After writing the skill, do a self-review: would another developer reading this know exactly what to generate?
