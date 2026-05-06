---
name: github-workflow
description: >-
  Guides the agent through the team's full GitHub workflow: opening Issues,
  writing Scopes, creating branches and PRs, labeling, and reviewing/merging.
  Use whenever the user asks to open an Issue, write a scope, create a PR,
  report work to a boss or team lead, file a bug, plan a feature, or asks
  how we work. Also use when the user says "report", "issue", "scope", "PR",
  "branch", or "how we work".
---

# GitHub Workflow

Every piece of work moves through four stages: **Issue → Scope → Branch+PR → Merge**. Nothing skips stages. Every change to `main` goes through a PR tied to an Issue.

## Stage 1: Issue

Open one as soon as an idea exists. Use `gh issue create` or the GitHub UI.

### Issue template

```markdown
## What
One or two sentences describing what we're building or fixing.

## Why
Why this matters — the user problem, business reason, or bug impact.

## Acceptance criteria
- [ ] Item 1
- [ ] Item 2
- [ ] Item 3

## Notes
Links, screenshots, dependencies, decisions already made.

## Scope
_To be filled in before work starts. Small bug fixes / trivial chores can skip this._
```

**Labels (required):**
- Type: `feature` | `bug` | `chore`
- Size: `size:S` (< half day) | `size:M` (half day–2 days) | `size:L` (> 2 days — consider splitting)

**Assignee:** assign to whoever is building it.
**Project:** add to the team Project board.

---

## Stage 2: Scope

Fill in the Scope section of the Issue **before any code is written**.

- **Always** for `size:M` and `size:L`.
- For `size:S` only when constraints aren't obvious.

### Scope template

```markdown
## Scope

### Boundaries
**In scope:**
- …
**Out of scope:**
- …

### Constraints
**Domain and ownership rules:**
- …
**Decisions already made:**
- …

### Code context
**Where this lives in the codebase:**
- …
**Existing components to reuse:**
- …
**What must not be touched:**
- …

### Infrastructure and data
**Data touched:**
- …
**External systems and services:**
- …
**Environments and deploy:**
- …

### Dependencies
**Depends on:** (other Issues/PRs that must land first)
**Blocks / will affect:** (Issues/teams waiting on this)

### Assumptions
- …

### Open questions
- … @name
```

For `size:M`/`size:L` scope, tag relevant owners for a quick review before moving to In Progress.

---

## Stage 3: Branch + Pull Request

```bash
git checkout main && git pull
git checkout -b <your-name>/<issue-number>-<short-description>
# e.g. shaul/42-dark-mode-toggle

# commit with issue reference
git commit -m "Add dark mode toggle (#42)"

git push -u origin <branch-name>
```

### PR template

```markdown
Closes #<issue-number>

## What changed
Short summary of what this PR does.

## Status
- [ ] Vibecoded / first pass — needs cleanup
- [ ] Production-ready
- [ ] Tests added or updated
- [ ] Tested locally

## What needs review
Specific things you want the reviewer to focus on.

## Screenshots / demo (if UI work)
```

**State labels:** `vibecoded` | `needs-cleanup` | `needs-review` | `ready-to-merge` | `blocked`

**Reviewer/Assignee:** set so it shows on their dashboard.

---

## Stage 4: Review and Merge

- Reviewer pulls branch, runs it, then: Approve + merge / request changes / push cleanup commits.
- `Closes #42` auto-closes the Issue on merge.
- Don't merge your own PRs unless explicitly agreed.
- Address review comments by pushing to the same branch — never open a new PR.

---

## Vibecode → Cleanup Flow

If vibecoding: tag `vibecoded` + `needs-cleanup`, list rough edges in the PR description, assign the cleanup person as reviewer.

If cleaning up: push directly to the author's branch; leave a short summary when approving.

---

## Daily Habits

- Pull `main` before starting anything new.
- One Issue, one PR — no bundled unrelated changes.
- Move cards on the Project board: Backlog → In Progress → In Review → Done.
- Add `blocked` label + comment if stuck — don't stall silently.
- Drop a quick message in chat when opening a PR or Issue.
