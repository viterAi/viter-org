# HPI Spec v0 — derived from Persofi working code

**Status**: draft, internal. Not yet a publishable artifact. Goal: prove the spec writes itself from production reconciliation code.

**Date**: 2026-05-06

---

## Premise

HPI = Hyperpersonalised API. Each human owns a sovereign API surface that exposes typed projections of their own L0→L3 cognitive substrate. Agents (LLMs, tools, other humans, future-self) request typed context via one-time, scoped tokens. The agent never holds the human's L3 — only borrows it for the duration of a transaction.

This is not a memory product. It is a substrate-boundary protocol.

---

## Why derive from Persofi

Persofi's reconciliation pipeline is already an HPI implementation in disguise. The Supabase tables are L0/L1 storage. The reconciliation logic is pure-function L2 synthesis. The /reconcile UI is a per-user L3 surface. What's missing: the typed access protocol.

Mapping Persofi's working surface onto HPI request types lets the spec earn its claims from running code, not whiteboard speculation.

---

## The four axiom families (from May 5 ontology brainstorm)

| Family | Domain | Persofi tables |
|---|---|---|
| **OBL-*** | Obligations: contracts, invoices, evidence, identity | `xero_invoices`, `statement_lines`, `match_results` |
| **RCG-*** | Recharges: trust-based renewal, recurring obligations | `recharge_status`, `xero_payments` |
| **TRU-*** | Trust: counterparty ratings, thresholds, confidence | `suppliers`, `match_results.confidence`, supplier history |
| **PAT-*** | Patents: legal lifecycle, IP-typed obligations | (gap — Section F unbuilt) |

Each axiom family defines a typed schema for the L0 entities under it. An OBL has a fixed shape (counterparty, amount, currency, due-date, evidence-pointer, status); an RCG has its own shape (parent OBL, period, renewal-rule, status); etc.

**The axiom is the spec; the table is just storage.** The same OBL can live in Postgres, in a JSON file, in a graph DB — the type is the contract, not the storage.

---

## HPI request taxonomy (derived from Persofi flows)

Five request kinds. Every HPI call falls into one of these.

### 1. READ — typed projection of L0/L1/L2

Agent fetches axiom-typed entities the human has authorized for the current scope.

```
HPI.read(token, type, filter, layer)
  type:   OBL | RCG | TRU | PAT
  filter: scoped query (e.g. status='open', counterparty=<id>)
  layer:  L0 (raw) | L1 (extracted) | L2 (synthesized)
  →       array of typed entities, each with provenance chain back to L0
```

Persofi today does this implicitly:
- Reconciliation /matches endpoint = `HPI.read(type=OBL, layer=L2, filter={status:'open'})`
- /suppliers/[id] page = `HPI.read(type=TRU, layer=L1, filter={counterparty:<id>})`

In HPI, these become typed protocol calls instead of CRUD endpoints. An external agent (Letta, a self-hosted Claude, a competitor's product) can request the same projection with the same shape.

### 2. PROPOSE — agent suggests an action against an entity, human ratifies

Agent fetches typed context, synthesizes an action, hands it back as a typed proposal. Human reviews and approves; agent never executes autonomously.

```
HPI.propose(token, action_type, target_entity, payload)
  action_type:    OBL_ACTION | RCG_RENEWAL | TRU_UPDATE | PAT_FILE
  target_entity:  ref to typed entity (OBL-12345, etc.)
  payload:        action-specific data (amount, date, counterparty, evidence)
  →               proposal_id (pending human ratification)
```

This is the "suggested payment / notify supplier" flow Jeffrey asked about (May 5 chat-log). In HPI form:
1. Agent calls `HPI.read(type=OBL, filter={status:'open', due_within_days:7})` → list of approaching obligations
2. Agent calls `HPI.read(type=TRU, filter={counterparty:<each>})` → counterparty trust scores
3. For each OBL above trust threshold, agent calls `HPI.propose(action=OBL_ACTION, target=<obl_id>, payload={action:'schedule_payment', amount, date, supplier})`
4. Human gets a typed proposal in the UI; clicks "approve"
5. Agent calls `HPI.execute(proposal_id, token)` to commit the action
6. Action becomes an L0 entity (the executed-payment record), provenance points back to the OBL

The agent never had write access. It only proposed. The human's substrate stayed sovereign.

### 3. EXECUTE — commit a ratified proposal

Pure write path, gated by prior PROPOSE + human ratification. Same shape across action types.

```
HPI.execute(token, proposal_id)
  → execution_record (L0 entity, immutable)
```

In Persofi this is the "Mark for payment" / "Reconcile" UI confirmation. Today it's hardcoded into the app; in HPI it's a generic typed mechanism.

### 4. SYNTHESIZE — agent requests a typed L2/L3 surface

Agent asks the human's HPI to GENERATE a synthesized view, not just retrieve. The human (or the human's pre-approved L2 synthesizer) produces it. The agent reads it once and discards.

```
HPI.synthesize(token, view_type, scope)
  view_type: AGING_OBLIGATIONS | TRUST_LEDGER | DECISIONS_TODAY | ...
  scope:     time-bound or entity-bound
  →          typed L2/L3 view, with citation chain to L0/L1
```

In Persofi: the variance-breakdown panel on /reconcile is exactly an `HPI.synthesize(view_type=AGING_OBLIGATIONS, scope={run_id:<x>})` result. Today it's computed inline; in HPI it's a typed protocol response.

Critical property: the view carries its citation chain. Every claim ("supplier X is over-exposed by Y%") points back to specific match_results rows, which point to specific statement_lines, which point to the original PDF L0. **Cite-or-Die enforced at protocol level.**

### 5. ATTEST — agent records observation back into human's substrate (with consent)

Agent proposes an L0 entity to be ingested into the human's substrate. Human ratifies. This is how new external information enters HPI.

```
HPI.attest(token, observation_type, payload, evidence)
  observation_type: TRU_OBSERVATION | OBL_DISCOVERED | ...
  payload:          typed observation
  evidence:         pointer or copy of source bytes
  →                 attestation_id (pending human ratification → becomes L0)
```

Use case: Mordechai's agent reads a Jeffrey email, notices a new supplier Persofi hasn't seen, calls `HPI.attest(type=TRU_OBSERVATION, payload={supplier:<details>, source_email_id:<x>}, evidence=<email_pointer>)`. Mordechai gets a typed attestation in his queue; approves; the supplier becomes a TRU L0 entity, provenance attached.

The agent never silently mutated state. The human's substrate only grew via consented attestations.

---

## Token mechanics

HPI tokens are **one-time, scoped, and revocable**.

```
token = sign(
  human_id,
  agent_identity,
  scope,           // OBL:read + TRU:read + OBL_ACTION:propose
  expires_at,      // typically <1 hour
  transaction_id   // single-use binding
)
```

Properties:
- **One-time**: one token = one transaction. Replayed token = rejected.
- **Scoped**: explicit list of (type, action) pairs. No wildcards.
- **Revocable**: human can invalidate any active token instantly.
- **Auditable**: every token use writes an entry to the human's L0 audit log.

Compare to OAuth's access tokens: OAuth grants long-lived broad scopes. HPI grants narrow single-use scopes. The right comparison is to capability-based security: each token is a literal capability for one action on one entity.

---

## Provenance shape

Every typed entity in HPI carries a provenance chain:

```
{
  id: "OBL-12345",
  type: "OBL",
  layer: "L1",
  payload: { ... },
  provenance: {
    ingester: "human:mordechai",
    creator:  "external:Insperanto",   // upstream — distinct from ingester
    ingested_at: "2026-05-04T14:35:00+03:00",
    cites: [
      { layer: "L0", ref: "statement_lines/abc123", hash: "sha256:..." },
      { layer: "L0", ref: "xero_invoice/xyz789", hash: "sha256:..." }
    ]
  }
}
```

Two-owner schema (creator vs ingester) is mandatory. Cite chain is mandatory. **No untyped, unprovenance-d entities cross HPI boundaries.**

---

## What this gets us in practice

1. **Persofi's MCP becomes HPI-compatible without rewriting.** Each existing endpoint maps to one of the five request kinds. The CRUD wrappers become typed projections.

2. **Insperanto can run Persofi as their HPI.** The same protocol that Mordechai's agents speak is the protocol Jeffrey's CFO-agent speaks. Same code, different human substrates.

3. **Multi-tenant solved by axiom.** Each tenant has their own HPI; their data never crosses substrate boundaries except via explicit inter-HPI calls (which themselves are typed and tokenized).

4. **The Section F (PAT-*) gap closes the same way the OBL gap closed.** Define the PAT-* axiom. Map the existing patent data to it. Done. The protocol is the spec; the implementation follows.

5. **External agents become first-class.** A Letta-shaped persistent agent can request HPI projections without owning Mordechai's L3. A self-hosted Claude can do the same. The hyperscaler walled gardens become irrelevant — context lives in the human's substrate, agents rent access.

---

## Minimum publishable artifact (90-day target)

To convert this draft into a real positional artifact:

1. Tighten this document to ~3000 words. Public.
2. Open-source a reference HPI daemon (Go or TypeScript, single binary, ~2000 LOC) that implements the five request kinds against a Postgres backend.
3. Publish HPI client library for MCP (so any MCP-speaking agent can request HPI projections immediately).
4. Demo: Persofi running on the reference daemon, showing OBL/RCG/TRU axioms in action.
5. One-page case study: "How Persofi reduced reconciliation time by X% by exposing typed obligations to an LLM via HPI."

The combination — spec + reference impl + working demo — is what protocol authors need. Letta has Context Constitution as a publication; Plurality has a whitepaper. HPI needs the same artifact existence to be in the conversation.

---

## Open questions

1. **PAT-* axiom shape** — what's the schema for a patent obligation? Mordechai needs Jeffrey's domain expertise. May 5's named gap is also the May spec gap.

2. **Inter-HPI calls** — how do two HPIs talk to each other (Mordechai's HPI ↔ Jeffrey's HPI)? Probably mediated by typed proposals + ratification on both sides. Worth a separate section.

3. **L2 synthesizer authority** — when Mordechai's HPI synthesizes a view, who actually runs the synthesis? Local LLM? Pre-approved cloud LLM? This needs a "synthesizer policy" concept inside HPI.

4. **Storage layer relationship to OCL/Plurality** — should HPI mandate a storage layer or be storage-agnostic? Storage-agnostic likely correct; OCL becomes one of several reference implementations.

5. **Revocation propagation** — if a token gets revoked mid-execution, how does the agent learn? Pull (poll) or push (webhook)? Probably both, with sane defaults.

---

## Next concrete actions

- Engage Plurality/OCL: draft a "HPI rides on OCL as storage" alignment proposal
- Read Letta's Context Constitution end-to-end; identify direct conflicts and direct adoptions
- Map every Persofi MCP endpoint to its HPI request-kind explicitly (a 1-2 hour exercise)
- Draft the PAT-* axiom by interviewing Jeffrey on his patent lifecycle (closes May 5 named gap)
- Write the reference daemon prototype (~weekend project to validate the protocol works end-to-end on a single tenant)
