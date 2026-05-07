# T-016 — Sequential View Golden Tests & Eval

**Wave:** 4 — Sequential Views  
**Estimate:** 0.5 day  
**Depends on:** T-014, T-015  
**Blocks:** Confidence in shipping sequential views

---

## Context

Same pattern as T-012 (Spatial eval), now applied to sequential views. We need golden test cases and an eval rubric to know when sequential view generation is good enough.

---

## Scope

Create 5 golden test cases for sequential view generation. Reuse the eval harness from T-012. Define rubric per Sequential View skill rules.

---

## Deliverables

1. 5 golden test cases in `evals/sequential-view/cases/`
2. Rubric per case based on T-014's SKILL.md rules
3. Eval report extended to cover sequential view alongside spatial

---

## Test Cases to Create

1. **Email triage** — inbox of 10 unread emails, user wants to process them
2. **Invoice approval queue** — 5 invoices pending approval over $1k threshold
3. **Customer support ticket review** — 8 tickets needing human review
4. **PRD checklist** — checklist extracted from a sample PRD with 12 items
5. **Onboarding wizard** — new source connection setup with 4 steps

For each, provide realistic input data and a clear user prompt.

---

## Rubric Examples

```json
{
  "rules": [
    {
      "id": "uses_sequence_controller",
      "rule": "Layout includes a sequence_controller node",
      "check": "spec.layout.some(n => n.type === 'sequence_controller')",
      "weight": 2
    },
    {
      "id": "action_button_count",
      "rule": "Action bar has between 2 and 4 buttons (Hick's Law)",
      "check": "const actions = spec.layout.find(n => n.type === 'single_item_focus').actions; actions.length >= 2 && actions.length <= 4",
      "weight": 2
    },
    {
      "id": "has_progress_indicator",
      "rule": "Spec includes a progress_indicator",
      "check": "spec.layout.some(n => n.type === 'progress_indicator')",
      "weight": 1
    },
    {
      "id": "has_completion_summary",
      "rule": "Spec defines completion behavior with a completion_summary",
      "check": "spec.layout.some(n => n.type === 'completion_summary')",
      "weight": 1
    },
    {
      "id": "has_escape_hatches",
      "rule": "Action set includes a 'Skip' or 'Save for later' option",
      "check": "spec.layout.find(n => n.type === 'single_item_focus').actions.some(a => /skip|later|defer/i.test(a.label))",
      "weight": 1
    },
    {
      "id": "has_briefing_intro",
      "rule": "Sequence starts with a briefing_intro showing item count",
      "check": "spec.layout.some(n => n.type === 'briefing_intro' && n.count !== undefined)",
      "weight": 1
    }
  ]
}
```

---

## Acceptance Criteria

- [ ] 5 golden test cases in `evals/sequential-view/cases/`
- [ ] Each case has input data, prompt, expected.md, rubric.json
- [ ] Each rubric has at least 5 rules with weights
- [ ] Eval harness from T-012 extended to handle sequential view cases
- [ ] Eval report includes both spatial and sequential sections
- [ ] Baseline score recorded (whatever it is)

---

## Notes for the Agent

- Use the same eval harness from T-012 — don't duplicate.
- If the harness needs extension to handle different view types' rubrics, do it generically (any view type can have a rubric set).
- Some rules apply across view types (e.g., "spec is valid JSON") — extract those into a shared rubric.
