# T-011 — Skill & Component Library Index Page

**Wave:** 3 — Skills  
**Estimate:** 0.5 day  
**Depends on:** T-002, T-004  
**Blocks:** Nothing (but Shaul needs visibility, so do this early)

---

## Context

Shaul needs to be able to see what skills and components exist without reading code. Right now there's no surface where the library is browsable.

This is the seed of the future Agent Management Space — a live surface in the platform where agents, skills, and components can be inspected. For now, a well-maintained markdown index in the repo is enough.

---

## Scope

Build a browsable index of skills and components. Auto-generate it from the source files where possible. Make it easy to keep updated.

---

## Deliverables

1. `docs/library/skills.md` — index of all skills with status, purpose, links to SKILL.md files
2. `docs/library/components.md` — index of all component primitives with props, screenshot, which skills use them
3. A simple script (`scripts/generate-library-index.ts`) that regenerates these files from the source
4. README in `docs/library/` explaining how to keep the index current

---

## Skills Index Format

`docs/library/skills.md`:

```markdown
# Skills Library

Last updated: [auto-generated]

## View Type Skills

### Spatial View
- **Status:** Formalized (T-010)
- **Purpose:** Dashboards, boards, grids — for users in overview mode
- **SKILL.md:** [link]
- **Used by:** Spec Composition skill
- **Examples:** [link to skills/spatial-view/examples/]

### Sequential View
- **Status:** Not started
- **Purpose:** Triage queues, wizards, approval flows — for users in decision mode
- **SKILL.md:** Not yet created
- **Used by:** —

[... rest of skills with same format ...]

## Pipeline Skills
[same format]

## Quality Skills
[same format]
```

---

## Components Index Format

`docs/library/components.md`:

```markdown
# Component Library

Last updated: [auto-generated]

## Core Primitives

### KPI Strip / Metric Strip
- **Component file:** `components/renderer/primitives/metric-strip.tsx`
- **Props:**
  - `metrics: Metric[]` (required)
  - `tokens?: DesignTokens` (optional override)
- **Used by:** Spatial View skill
- **Spec node type:** `metric_strip`
- **Screenshot:** [embedded image]

### Data Table
- **Component file:** `components/renderer/primitives/data-table.tsx`
- **Props:** [auto-extracted from prop types]
- **Used by:** Spatial View skill, Sequential View skill (for list mode)
- **Spec node type:** `data_table`
- **Screenshot:** [embedded image]

[... rest of components ...]
```

---

## Auto-Generation Script

The script should:
1. Walk the `skills/` directory and extract metadata from each SKILL.md (purpose, status from a YAML frontmatter)
2. Walk the `components/renderer/primitives/` directory and extract props from TypeScript types
3. Take screenshots of each component (use a Storybook-like setup or render the component in a test env, capture with Playwright)
4. Write the index files

If full auto-generation is too much, a hybrid approach is fine:
- Auto-extract what's mechanical (file paths, prop types)
- Manually maintain the prose (purpose, status, screenshots)
- Script flags when something is missing

---

## SKILL.md Frontmatter

To enable auto-extraction, every SKILL.md should start with YAML frontmatter:

```markdown
---
name: Spatial View
status: formalized | in-progress | not-started | queued
purpose: Dashboards, boards, grids — for users in overview mode
used_by: [Spec Composition]
view_types: [spatial]
---

# Spatial View Skill
[... rest of file ...]
```

The script reads this frontmatter to populate the index.

---

## Acceptance Criteria

- [ ] `docs/library/skills.md` exists and lists all 10 skills (from PRD section on skills) with current status
- [ ] `docs/library/components.md` exists and lists all current component primitives
- [ ] Each component entry includes a screenshot (PNG embedded or linked)
- [ ] Each component entry includes the props (auto-extracted from TypeScript)
- [ ] Each component entry shows which spec node type it maps to
- [ ] Each skill entry includes status, purpose, link to SKILL.md (if exists)
- [ ] `scripts/generate-library-index.ts` runs and regenerates the files
- [ ] All existing SKILL.md files have YAML frontmatter (only Spatial View exists right now from T-010)
- [ ] README in `docs/library/` explains: when to run the script, how to add a new skill or component

---

## Notes for the Agent

- Don't over-engineer the auto-generation. If taking screenshots is hard, just include manually-captured screenshots and have the script confirm they exist.
- Update the script as a hook in `package.json` so it runs on `npm run docs` or similar.
- For now, the index lives in `docs/`. Later it will become a live surface in the platform — but that's the future Agent Management Space, not this ticket.
- Make sure the script is idempotent — running it twice produces the same output.
