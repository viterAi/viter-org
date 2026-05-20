# L2 Axiom Citations — Schema Spec

> This file specifies the `cites_axioms` column on `l2_syntheses`
> and the `confidence` / `representation` fields required by VTA-1.
> See `viter-ontology/CITATION-CONTRACT.md` for the grammar and enforcement rules.

---

## Migration

```sql
-- Add citation columns to l2_syntheses
ALTER TABLE l2_syntheses
  ADD COLUMN IF NOT EXISTS cites_l1     UUID[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cites_axioms TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS confidence   NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS representation TEXT[];  -- e.g. ['text/structured', 'text/ocr']

-- Trigger: enforce citation contract at write time
CREATE OR REPLACE FUNCTION enforce_l2_citation_contract()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF array_length(NEW.cites_l1, 1) IS NULL THEN
    RAISE EXCEPTION 'L2 row requires at least one L1 citation [SHL2-1]';
  END IF;
  IF array_length(NEW.cites_axioms, 1) IS NULL THEN
    RAISE EXCEPTION 'L2 row requires at least one axiom citation [CITATION-CONTRACT]';
  END IF;
  IF NEW.confidence IS NULL THEN
    RAISE EXCEPTION 'L2 row requires confidence score [VTA-1]';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER l2_citation_contract
  BEFORE INSERT OR UPDATE ON l2_syntheses
  FOR EACH ROW EXECUTE FUNCTION enforce_l2_citation_contract();

-- Index: "show me every L2 that cites OBL-4"
CREATE INDEX IF NOT EXISTS l2_cites_axioms_gin
  ON l2_syntheses USING GIN (cites_axioms);

CREATE INDEX IF NOT EXISTS l2_cites_l1_gin
  ON l2_syntheses USING GIN (cites_l1);
```

---

## TypeScript type

```typescript
export interface L2Synthesis {
  id: string;
  tenant_id: string;
  fact_class: string;
  claim: string;

  // Citation contract (required by CITATION-CONTRACT.md)
  cites_l1: string[];          // UUIDs of L1 rows used
  cites_axioms: string[];      // e.g. ["OBL-3@persofi", "VTA-1@viter-org"]
  confidence: number;          // 0–1: how sure are we the extraction is right
  representation: string[];    // e.g. ["text/structured", "text/ocr"]

  // Derivation metadata
  generated_by: string;        // extractor name + version
  generated_at: string;        // ISO timestamp
  cost_usd?: number;           // per VTA-2: cheapest tool that hits benchmark

  // Staleness (per SHL-STALE-1)
  is_stale: boolean;
  stale_reason?: string;
}
```

---

## Querying by axiom

```sql
-- Every L2 that used OBL-4 to resolve a source conflict
SELECT id, fact_class, claim, confidence
FROM l2_syntheses
WHERE 'OBL-4@persofi' = ANY(cites_axioms)
ORDER BY generated_at DESC;

-- Impact of mutating PAT-1: everything that would need re-review
SELECT id, fact_class, generated_at
FROM l2_syntheses
WHERE 'PAT-1@insperanto' = ANY(cites_axioms)
  AND NOT is_stale;

-- All L2s with low-confidence OCR representation
SELECT id, fact_class, confidence, representation
FROM l2_syntheses
WHERE 'text/ocr' = ANY(representation)
  AND confidence < 0.85;
```

---

## VTA-1 — confidence vs representation (the key distinction)

These are **independent** fields, not a single score:

| Field | Question it answers | Example low value means |
|---|---|---|
| `confidence` | How sure are we the extraction is *correct*? | Model hallucinated; OCR was poor; sources disagreed |
| `representation` | What modality/fidelity is the source material? | PDF (lossy OCR), image (vision model), audio (whisper) |

A hand-typed Xero entry has `confidence=0.99, representation=['text/structured']`.
A scanned PDF invoice has `confidence=0.91, representation=['text/ocr']`.
An image of a whiteboard has `confidence=0.75, representation=['image/vision']`.

**Same obligation, three different representations. Confidence tracks extraction quality; representation tracks source type.** They diagnose different failure modes.
