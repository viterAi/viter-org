# @vita/runtime

The substrate runtime: extractors that turn `l0_artifacts` into `l1_events`.

## Architecture

```
adapter (Railway worker)              ←  streams L0 in (file watch / IMAP / webhook)
  │
  └→ creates l0_artifacts row
  └→ inserts l1_extraction_runs row(s)
        │
        └→ runner picks up the run, calls extractor:
             extractor(artifact, run, ctx) → AsyncIterable<L1EventInsert>
        │
        └→ runner inserts events, marks run.status='ok', flips l1_active_extraction
```

## Extractors today

| Source type | Facets | Extractor | Deterministic |
|---|---|---|---|
| `claude_code_jsonl` | `turn_text`, `tool_calls` | `claudeCodeJsonl` | ✅ |

## Adding a new extractor

1. Write a function with signature:
   ```ts
   const myExtractor: Extractor = async function*(artifact, run, ctx) {
     // pure-function over (artifact, run.parameters)
     // yield L1EventInsert objects
   };
   ```
2. Register in `src/extractors/index.ts` under `${source_type}:${facet}` keys.
3. If non-deterministic (LLM-based), set `is_deterministic: false` so the active-pointer machinery applies.

## Pure-function rule

Extractors must be pure functions of `(artifact, run.parameters)`. No global state. Re-running with the same inputs must produce the same events. The DB constraint `unique (tenant_id, artifact_id, facet, extractor, version, parameters)` enforces this from the data side.
