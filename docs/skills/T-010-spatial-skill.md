# T-010 — Formalize Spatial View Skill (SKILL.md)

**Wave:** 3 — Skills  
**Estimate:** 0.5 day  
**Depends on:** T-003  
**Blocks:** T-012

---

## Context

The current AI generation prompt has some spatial dashboard rules baked in (KPIs at top, tables below, chart type selection). But it's an unstructured prompt buried in code, not a documented, testable, versionable artifact.

A "skill" in our architecture is a SKILL.md file that the agent consults during generation. It's a structured, explicit set of rules — not a prompt blob. The skill guides generation; the validator catches violations after.

This ticket extracts the spatial design rules into a proper SKILL.md and makes the agent consult it during generation.

---

## Scope

Write `skills/spatial-view/SKILL.md` with explicit rules for spatial view generation. Update the agent to load and apply these rules. Update the spec validator to check the same rules.

---

## Deliverables

1. `skills/spatial-view/SKILL.md` — the skill document
2. Agent integration: agent reads SKILL.md and includes the rules in its generation prompt
3. Validator integration: rules in SKILL.md are programmatically checkable
4. Skill index entry (will be properly indexed in T-011, but at least register it)

---

## Required Rules in the Spatial View SKILL.md

The skill must encode at minimum these rules, with explicit enforcement criteria:

### Information hierarchy
- F-pattern scanning: most important content top-left
- Primary KPIs at the top, in a horizontal strip
- Secondary content below
- Detail content accessed via click/expand, not always visible

### Limits
- Maximum 12 KPIs in a strip (working memory limit)
- Recommended 3–5 KPIs for highest comprehension
- Maximum 4 visualizations on one screen
- Tables limited to 8 columns visible by default (overflow becomes horizontal scroll or column hide menu)

### Chart type selection rules
- Single number with trend → metric card with trend indicator
- Comparison across categories → bar chart
- Trend over time → line chart
- Composition / parts of whole → pie/donut (only if ≤6 segments)
- Distribution → histogram
- Relationship between two variables → scatter plot

### The 5-second rule
- The most critical information must be graspable in 5 seconds
- This means: largest font, highest contrast, top-left position
- Test: can someone tell you the most important number from a screenshot they saw for 5 seconds?

### Color rules
- Color is meaning, not decoration
- Use semantic colors: success/positive (green), warning (amber), danger/negative (red), neutral (default)
- Trends: up-good and down-good both use green; up-bad and down-bad both use red
- Don't use color as the only signal — pair with icons or labels for accessibility

### Density rules
- Generous whitespace between sections
- Cards with internal padding ≥ 16px
- Section gaps ≥ 24px
- Don't pack the screen edge-to-edge

### Filter and action affordances
- Filter bar above the data, not buried in a sidebar
- Actions per-row in tables (not separate action menus that require selection)
- Bulk actions appear when multiple rows are selected

---

## SKILL.md Structure

The file should follow this template:

```markdown
# Spatial View Skill

## Purpose
[One paragraph: what this skill is for, what cognitive mode the user is in]

## When to Use This Skill
[Decision rules for when the spec composer should invoke this skill vs. another]

## Generation Rules
[The rules above, one per subsection, each with enforcement criteria]

## Anti-Patterns
[Things to never do — with examples]

## Examples
[2–3 example specs that follow the skill correctly]

## References
[Links to the research that backs each rule: NN Group, Stephen Few, etc.]
```

---

## Agent Integration

The agent's generation flow must:
1. Read the SKILL.md file at generation time (or have it bundled into the prompt)
2. Include the rules in the prompt to the model
3. After generation, run the validator against the same rules

The validator should be a code module that takes a spec and returns:
```typescript
interface ValidationResult {
  passed: boolean;
  violations: Violation[];
}

interface Violation {
  rule: string;           // which rule was violated
  severity: 'error' | 'warning';
  message: string;
  suggestion?: string;
}
```

---

## Acceptance Criteria

- [ ] `skills/spatial-view/SKILL.md` exists and contains all rules from the section above
- [ ] Each rule is explicit enough that a programmatic check can be written for it
- [ ] Agent reads the skill at generation time (verify by checking the prompt sent to the model includes the rules)
- [ ] Validator (`lib/skills/spatial-view-validator.ts`) checks specs against the rules and returns structured violations
- [ ] Validator integrated into the generation pipeline: violations of severity 'error' trigger a retry with corrective feedback
- [ ] References section in SKILL.md links to (or excerpts from) NN Group, Stephen Few, Tufte
- [ ] Two example specs in `skills/spatial-view/examples/` demonstrating correct application
- [ ] Two anti-pattern specs in `skills/spatial-view/anti-patterns/` showing what to avoid

---

## Notes for the Agent

- Read the existing page-composer prompt and the spec-quality validator before writing the SKILL.md. Extract what's already there; don't reinvent.
- The skill is a *living document*. It should be readable by humans and processable by code. Keep it in markdown for human readability; structure rules with clear formatting so a parser could extract them if needed.
- Don't make rules vague. "Use good colors" is bad. "Use red for negative trends, green for positive trends, amber for warnings" is good.
- Don't add rules you can't enforce. If a rule is "make it look good," it doesn't belong in the SKILL.md.
- This is the template for all future view-type skills. Take time to get the structure right.
