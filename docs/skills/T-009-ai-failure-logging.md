# T-009 — AI Failure Pattern Logging

**Wave:** 2 — Core Loop  
**Estimate:** 0.5 day  
**Depends on:** T-002  
**Blocks:** Model selection decision

---

## Context

The current AI pipeline has an 85% first-attempt success rate and a 20-retry loop per generation. We don't know *why* it fails — we just know it does and we retry until it works. This is fragile and we can't improve it without diagnosis.

Before deciding whether to switch models (Claude vs. Gemini vs. GPT-4) or invest in prompt engineering, we need to know what kinds of failures are happening.

---

## Scope

Add structured failure logging to the AI generation pipeline. Categorize each failure. Build a simple report so we can see the breakdown.

---

## Deliverables

1. Failure logging in the AI generation flow — every retry logs the failure type
2. Supabase table `ai_generation_logs` with structured fields
3. A simple admin page or markdown export that shows: total generations, success rate, breakdown by failure type
4. First-attempt success rate broken down by view type (spatial vs. sequential, etc.)

---

## Failure Categories

Every retry must be classified into one of these:

- **JSON_PARSE_ERROR** — output isn't valid JSON
- **SCHEMA_VIOLATION** — JSON parses but doesn't match expected spec structure
- **FIELD_REFERENCE_ERROR** — spec references a field that doesn't exist in the source data
- **VALIDATION_ERROR** — spec violates a quality rule (too many KPIs, wrong chart type for data, etc.)
- **DATA_BINDING_ERROR** — binding expression can't be resolved (e.g., aggregation on a non-numeric field)
- **TIMEOUT** — model didn't respond within the timeout
- **API_ERROR** — model API returned an error
- **OTHER** — anything else (with the actual error message logged)

---

## Schema

```sql
CREATE TABLE ai_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_id UUID REFERENCES views(id),
  user_id UUID,
  attempt_number INT NOT NULL,        -- 1, 2, 3, ...
  view_type TEXT,                      -- spatial / sequential / briefing / card / config
  model TEXT,                          -- e.g., "gemini-3-flash"
  success BOOLEAN NOT NULL,
  failure_category TEXT,               -- one of the categories above (NULL if success)
  error_message TEXT,                  -- full error for debugging
  duration_ms INT,
  prompt_tokens INT,
  completion_tokens INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Acceptance Criteria

- [ ] `ai_generation_logs` table created via migration
- [ ] Every AI generation attempt is logged (success or failure)
- [ ] Every retry is a separate log entry (so we can count retries per generation)
- [ ] Failures are correctly categorized
- [ ] First-attempt success rate is computable from the data
- [ ] Admin page or report at `/admin/ai-stats` shows:
  - Total generations (last 7 days, last 30 days)
  - Overall first-attempt success rate
  - Success rate broken down by view type
  - Failure breakdown by category (count and percentage)
  - Average retries per successful generation
- [ ] Sample export: a markdown file or JSON with the same data, that can be shared with Shaul

---

## Notes for the Agent

- Don't over-engineer this. A simple admin page (or even just a SQL query that produces the report) is enough.
- The classification of failure categories happens at the point of failure — wrap each potential failure mode in a try/catch and tag it.
- For VALIDATION_ERROR and FIELD_REFERENCE_ERROR, log enough context to diagnose: which rule was violated, which field was missing.
- Don't change the retry behavior in this ticket — just add observability. We'll change the retry logic once we know what the failures look like.
- Run this for at least a day's worth of generation attempts before sharing the report. Real data, not synthetic.
