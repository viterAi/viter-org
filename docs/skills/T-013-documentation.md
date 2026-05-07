# T-013 — Documentation: Spec, Connector, Authoring Guides

**Wave:** 3 — Skills  
**Estimate:** 0.5 day  
**Depends on:** T-003, T-006  
**Blocks:** Onboarding new contributors

---

## Context

T-003 produced the spec format and T-006 produced the connector interface. Both have inline documentation, but neither has a holistic authoring guide that someone new to the project could read.

This ticket consolidates and completes the documentation needed for the project to be self-explanatory.

---

## Scope

Write three authoring guides covering: spec format, connector interface, skill authoring, component authoring. Make them concrete, with worked examples.

---

## Deliverables

1. `docs/guides/spec-format-guide.md` — full reference for the spec format
2. `docs/guides/connector-authoring.md` — how to write a new connector
3. `docs/guides/skill-authoring.md` — how to write a new SKILL.md
4. `docs/guides/component-authoring.md` — how to add a new component primitive
5. Update top-level `README.md` with links to all guides

---

## Required Content per Guide

### Spec Format Guide
- Every field in the spec (top-level and nested) explained with examples
- Worked example: building a spec from scratch for "show me overdue invoices"
- The mapping layer: how abstract specs become rendered components
- Common pitfalls: what to avoid

### Connector Authoring Guide
- The `Connector` interface in full
- A worked example: pseudocode for a "WeatherConnector"
- How connectors register themselves with the registry
- How action specs reference connectors
- Read vs. write vs. subscribe — which to implement

### Skill Authoring Guide
- The SKILL.md template (from T-010)
- The YAML frontmatter format (from T-011)
- How rules should be written: explicit, enforceable, with research backing
- How rules become validators
- Examples of good rules vs. bad rules

### Component Authoring Guide
- The component file structure
- Required props (every component must accept design tokens)
- How components map to spec node types
- Where to register new components
- How to add a screenshot for the library index

---

## Acceptance Criteria

- [ ] All four guides exist in `docs/guides/`
- [ ] Each guide has a worked example
- [ ] Each guide answers: "I want to add a new X — where do I start?"
- [ ] README.md has a "Documentation" section linking to all guides
- [ ] No guide is longer than ~5 pages of markdown — keep them practical
- [ ] Guides reference the actual code (file paths, interface names) so they stay grounded

---

## Notes for the Agent

- These are practical guides, not academic explanations. Include code, not theory.
- If something is documented in a SKILL.md or in the spec format types, link to that — don't duplicate.
- Use diagrams where helpful (Mermaid syntax for flowcharts in markdown).
- Test the guides by following them yourself: can you actually write a new connector by following your own guide? If not, fix the gaps.
