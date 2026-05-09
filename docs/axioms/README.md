# Vita Platform Axioms

Axioms that govern the Vita substrate — the layer every domain ontology runs on.

These are **VTA-*** and **SPC-*** axioms. Domain axioms (OBL-*, RCG-*, TRU-*, PAT-*) live in `viterAi/viter-ontology`. Tenant axioms (INS-*, PFS-*) also live there.

---

## Files

| File | Prefix | What |
|---|---|---|
| `substrate.md` | `VTA-*` | Core substrate: confidence/representation, cost-as-ontology, non-destructive tooling, MCP-as-typed-projections, tenant isolation, artifact + extraction identity |
| `spaces.md` | `SPC-*` | Role-routing layer: spaces as typed projections, sources≠spaces boundary, cross-space meta-projections |

## Layer position

```
SHELET (abstract meta-rules — conceptual, not a file)
     ↓ implemented by
VTA-* + SPC-*   ← this folder
     ↓ built on top of by
OBL-* RCG-* TRU-* PAT-*   (viterAi/viter-ontology)
     ↓ configured by
INS-* PFS-*                (viterAi/viter-ontology/clients/*/tenant-axioms.md)
```

## Axiom ID format

`VTA-{n}` and `SPC-{n}` — globally unique, immutable. See `viterAi/viter-ontology/CITATION-CONTRACT.md` for the full citation grammar and stability contract.

## Related

- Citation schema for L2: `../l2-axiom-citations.md`
- Domain axioms: `viterAi/viter-ontology`
