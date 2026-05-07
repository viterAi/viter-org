# T-012 — Spatial View Golden Test Cases & Eval Loop

**Wave:** 3 — Skills  
**Estimate:** 1 day  
**Depends on:** T-010  
**Blocks:** Confidence in shipping spatial views

---

## Context

Right now, the only way to know if a generated view is "good" is to look at it and have a feeling. That's not a quality system. We need an evaluation framework that can score generated specs against known-good criteria.

This ticket builds the eval framework for spatial views, with a small set of golden test cases. The same pattern will be replicated for Sequential and other view types in later tickets.

---

## Scope

Create 5 golden test cases for spatial view generation. Build an eval harness that runs the AI generator against each test case and scores the output. Produce a pass/fail report per rule.

---

## Deliverables

1. 5 golden test cases (`evals/spatial-view/cases/`) — each with input data and expected spec characteristics
2. Eval harness (`evals/run-eval.ts`) — runs the AI against the cases and produces a report
3. Rubric per rule from T-010's SKILL.md (which rules are checked, how scoring works)
4. CI integration: eval can be run in CI and fails the build if quality drops below threshold (optional but recommended)

---

## Golden Test Case Format

Each test case is a directory with:

```
evals/spatial-view/cases/case-01-invoices-aging/
  input.json           # source data (e.g., a sample of Xero invoice data)
  prompt.txt           # user request (e.g., "show me my aging receivables")
  expected.md          # what a good spec should look like — described in prose, not exact JSON
  rubric.json          # programmatic checks
```

### `expected.md` example:

```markdown
# Expected Output for Case 01

## What this view should show
A spatial dashboard for aging receivables with:
- KPI strip at the top with: total outstanding amount, count of overdue invoices, average days overdue
- A data table below sorted by days overdue (descending)
- A chart showing distribution of outstanding amounts by client (top 10)

## What it should NOT do
- Should not include a pie chart for invoice statuses (data has too many categories)
- Should not include more than 5 KPIs (working memory limit)
- Should not bury the most overdue invoices in the middle of the table
```

### `rubric.json` example:

```json
{
  "rules": [
    {
      "id": "kpi_count_limit",
      "rule": "Number of KPIs in the metric_strip is between 3 and 5",
      "check": "spec.layout.find(n => n.type === 'metric_strip').metrics.length >= 3 && <= 5",
      "weight": 1
    },
    {
      "id": "kpi_includes_total_outstanding",
      "rule": "Total outstanding amount is one of the KPIs",
      "check": "spec.layout.find(n => n.type === 'metric_strip').metrics.some(m => m.label.toLowerCase().includes('outstanding') || m.label.toLowerCase().includes('total due'))",
      "weight": 2
    },
    {
      "id": "table_sorted_by_overdue",
      "rule": "Data table is sorted by days_overdue descending",
      "check": "spec.layout.find(n => n.type === 'data_table').sort?.field === 'days_overdue' && spec.layout.find(n => n.type === 'data_table').sort?.direction === 'desc'",
      "weight": 2
    },
    {
      "id": "no_inappropriate_pie_chart",
      "rule": "If a pie/donut chart is used, it has at most 6 segments",
      "check": "!spec.layout.find(n => n.type === 'chart' && (n.chart_type === 'pie' || n.chart_type === 'donut') && n.segments > 6)",
      "weight": 1
    }
  ]
}
```

---

## Test Cases to Create

Build at least these 5:

1. **Invoices aging** — financial dashboard with KPIs, table, chart
2. **Project status overview** — board-style with stages and counts
3. **Sales pipeline** — funnel-like data with conversion metrics
4. **Customer health scores** — table with ranking, KPIs, indicator chart
5. **Inventory levels** — table with stock counts, low-stock alerts, supplier chart

For each, provide realistic sample data (200-500 rows) and a clear user prompt.

---

## Eval Harness

`evals/run-eval.ts` should:

1. Iterate through every test case in `evals/spatial-view/cases/`
2. For each case:
   - Load input.json and prompt.txt
   - Call the AI generation pipeline
   - Capture the resulting spec
   - Run each rule from rubric.json against the spec
   - Score: weighted sum of passed rules / total weight
3. Produce a report:

```
Spatial View Eval Report — [date]
=================================

Case 01 — Invoices aging
  PASS rubric/kpi_count_limit (weight 1)
  PASS rubric/kpi_includes_total_outstanding (weight 2)
  FAIL rubric/table_sorted_by_overdue (weight 2)
    Reason: spec.layout[1].sort is undefined
  PASS rubric/no_inappropriate_pie_chart (weight 1)
  Score: 4/6 (67%)

[... other cases ...]

OVERALL
  Cases passed (≥80% score): 3/5
  Average score: 78%
  PASS THRESHOLD: 80%
  RESULT: BELOW THRESHOLD
```

---

## Acceptance Criteria

- [ ] 5 golden test cases in `evals/spatial-view/cases/` with input, prompt, expected.md, rubric.json
- [ ] Sample data is realistic (not 3-row toy datasets)
- [ ] Each rubric has at least 4 rules with weights
- [ ] Eval harness runs all cases and produces a report
- [ ] Report is generated in both markdown (for humans) and JSON (for CI consumption)
- [ ] Running the eval against the current spatial view generator produces a baseline score (whatever it is — we'll improve from there)
- [ ] If integrated with CI: a config file specifies the pass threshold (default: 75%) and the eval runs on every PR
- [ ] Documentation in `evals/README.md` explains how to add a new case and how to interpret the report

---

## Notes for the Agent

- Don't aim for the test cases to all pass on the first run. The point is to measure where we are. A 60% baseline that we can improve to 90% is the workflow.
- The rubric checks should be deterministic — given the same spec, they always produce the same result.
- If a rule is hard to express programmatically, write it as a TODO with a manual review note. Don't skip it; flag it.
- Use a separate model run per case — don't batch them, because each case is supposed to be an independent test.
- Cache the AI outputs so repeated eval runs don't burn tokens unnecessarily.
