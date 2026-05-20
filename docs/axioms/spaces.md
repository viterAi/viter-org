# Axiom family SPC — Spaces (role-routing layer)
# Owner: Vita platform · Layer: substrate · Prefix: SPC-*

---
layer: substrate
owner: viter-org
depends_on:
  - SHL2-1@shelet    # L2 must cite L1 (spaces render L2-derived facts)
  - VTA-1@viter-org       # confidence + representation (facts spaces display carry these)
---

## The opinion

A worldview that's true *for everyone* is useless to *anyone*. The same patent, the same obligation, the same recharge means different things to a salesperson, an operator, and a finance lead. Without a typed mechanism for routing the worldview through *whose-eyes-am-I-seeing-this-with*, the system either drowns each role in irrelevant facts or hides the facts that matter to them.

A **Space** is that typed routing mechanism. It is not a page, a tab, or a dashboard. It is a **typed projection over an entity's axiom-derived facts**, addressed by role.

> *"The spaces are basically aggregated and upgraded data from the different sources."*
> — Shaul Levine, 2026-05-03 00:28 IDT

---

## Axioms

> **SPC-1:** A `Space` is a typed projection over the entity's worldview, addressed by `(entity, space_name)`. Spaces are **views**, never sources of truth. Every fact a space displays must trace to an axiom-derived projection over the entity's underlying graph. A space cannot hold a fact that isn't derivable from the layer below.

> **SPC-2:** Each entity has a **fixed default set of spaces**: `sales`, `operations`, `finances`, `dev`. Custom spaces are allowed but must be declared per-entity with their projection rule. The default set is the contract; deviations are explicit.

> **SPC-3:** Each space has its own policy MDs at `<entity>/<space>/{policies,strategy,playbook}.md`. These describe *how that role does its work* — they are not derived from the worldview. When a space's policy conflicts with a worldview-derived fact, the fact wins and the policy must be updated.

> **SPC-4:** A space's view is a **typed projection** with three components:
> - **Filter** — which subset of underlying nodes/edges this role sees
> - **Aggregation** — how facts are summarized for this role
> - **Action set** — which mutations this role can request
>
> All three components are declared explicitly and are citable in any L2 the space produces.

> **SPC-5:** **Spaces are not sources.** A space cannot ingest data from outside the entity's worldview. If a space needs to display something not in the worldview, it must first land in a source and flow through the axiom layer. This prevents spaces from becoming silos of unofficial facts.

> **SPC-6:** **Sources are not spaces.** A source (Plunet, Xero, email, WhatsApp) is a typed input pipeline landing evidence into the worldview. Sources have no role-addressability. A salesperson does not "open Plunet" — they open the *sales* space, which projects Plunet-sourced facts into a sales-shaped view.

> **SPC-7:** **The cross-space view is itself a space.** When a question crosses roles, it lands in a meta-space — typically `dev` for engineering or `executive` for cross-cutting leadership. Cross-space views are declared meta-projections with explicit filter / aggregation / action-set specs, not free-form joins.

---

## Source: Shaul's Vita Substrate v0.1 (2026-05-03)

> *"we have the spaces, sales, operations, finances, and we've got the sources. Each one has their own view. The spaces are basically aggregated and upgraded data from the different sources."*

SPC-* is the typed formalization of that architectural decision. Sources land L0 evidence; spaces project L2 facts by role.
