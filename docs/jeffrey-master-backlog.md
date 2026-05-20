# Jeffrey Levine — Master Product Backlog
**Compiled:** 2026-05-10  
**Sources:** 196 WhatsApp messages · 25 documents · 1,717 meeting utterances · 36 screenshot captions  
**Meetings:** Apr 15 (Google Meet) · Apr 27 Jerusalem day (7 parts) · Apr 30 morning call  

---

## The One Quote That Frames Everything

> *"The problem that we've got today is that we've lost visibility. I'm getting a lot of surprises in invoices that I haven't received every month."*
> — Jeffrey, Apr 15 [11:10:04]

**Counterpoint, 15 days later:**

> *"I'm so loving it."*
> — Jeffrey, Apr 30 [10:10:26]

The backlog exists to close that gap permanently.

---

## Jeffrey's 6 Mental Models

These are not features — they are the cognitive frame through which every requirement must be read.

### 1. "The Completeness Problem"
His primary anxiety is not wrong data — it's *missing* data. Two equally risky gaps:
- Supplier delivered work, didn't send invoice → we haven't recharged the client
- We recharged the client, but never recorded the supplier cost

> *"The big risk is that if somebody has not given an invoice, maybe I haven't recharged it. Another risk for my accounting is maybe I've recharged it but I haven't recorded the cost. So they're both very risky."* — Apr 15 [11:16:50]

### 2. "Plunet Is Sticky But Broken"
$30K sunk cost to set up. He knows it's inadequate. He will not replace it.

> *"We spent $30,000 setting up Plunet with the consultant. And you know, it's like really shitty."* — Apr 27 Part 4 [21:45:46]

**Implication:** Persofi wraps Plunet and fills the gaps (post-prosecution data, un-costed jobs). Never replaces it.

### 3. "Excel Is the Mental Model"
Every time Jeffrey describes a desired output, he says "I want to see it almost in the Excel" or "a table." His comfort zone is Excel-native visual design: rows, columns, variance column, sum at bottom.

> *"I want to see it almost in the Excel."* — Apr 30 [10:35:57]

**Implication:** The UI must mirror this. Tables over charts. Numbers over visualizations.

### 4. "The Statement Is the Anchor"
Reconciliation starts with the supplier statement, not Xero or Plunet. Statement is the external ground truth. Everything is checked against it. The cut-off date matters.

> *"Rule — last update is King."* — Apr 16 WhatsApp

### 5. "Visibility Now, Automation Later"
He explicitly sequences: Stage 1 = reports and dashboards (real value, deliverable now). Stage 3 = AI agent on email.

> *"We have stage one — to show that what you're doing now and show the value. But the real value is to go and put an AI agent onto the email."* — Apr 27 Part 4 [22:14:33]

### 6. The ROI Pitch (his words)
> *"We can probably save one full-time person and that's 20,000 shekels a month. That's where you justify your ticket."* — Apr 27 Part 5 [21:55:55]

---

## Canonical Domain Rules

These are business logic rules the system must encode. Stated by Jeffrey, often multiple times across multiple channels.

| # | Rule | Quote | Source |
|---|---|---|---|
| R01 | Invoice# + Amount exact match → auto-approve, date irrelevant | "If the invoice number and amount match, date differences should be ignored" | Magallem doc + Apr 30 |
| R02 | Paid invoices ≠ variance — separate category: "paid but still on statement" | "The variance includes the paid invoices which are not a variance per say" | May 4 WhatsApp + Apr 30 |
| R03 | Sales invoices (AR) must be excluded from AP balance | "it could be you are including Sales Invoices which needs to excluded" | Mar 31 WhatsApp |
| R04 | Last statement is KING — new upload supersedes all previous for that supplier | "Rule — last update is King" | Apr 16 WhatsApp |
| R05 | Timing differences → ignore (invoices settled within the month) | "ignore timing differences" | Apr 19 WhatsApp |
| R06 | Variance = missing invoices + amount mismatches only, in source currency | "the variance should be the value in Source currency of missing invoices, and incorrect invoice amounts" | Apr 19 WhatsApp |
| R07 | GBP conversions are estimates — only source-currency recon targets 100% | "For supplier Recon it is 100%, GBP is an estimate" | Apr 16 WhatsApp |
| R08 | WIP = cost present but no invoice — NOT projects invoiced at a loss | "the way I did work in progress was — when basically when I have a cost but no invoice" | Apr 27 Part 7 |
| R09 | Payment run: 25th of each month is the fixed cadence | "the 25th of each month we have a payment run" | Apr 30 [10:15:57] |
| R10 | Supplier can also be customer (e.g., Morgan Lewis) — must not cross-contaminate AP | "No, they are both supplier and a customer." | Apr 27 Part 2 |
| R11 | INS-prefix invoice numbers = post-prosecution (old system); P-prefix = new code | "Anything with INS is a post-prosecution in the old system. Put a P in front" | Apr 27 Part 7 |
| R12 | Post-prosecution detection by job number age: 700+ job = over a year old = post-prosecution | "if it's a 700 job which is like over a year old, that has to be by definition" | Apr 27 Part 5 |
| R13 | Filter to last 3–6 months — pre-2026 data is noise | "filter this for the last three months or six months" | Apr 27 Part 7; "keep data only from 1 Jan 26" | Apr 28 WhatsApp |
| R14 | Spend = Sales − Official Fees (the margin base, not total sales) | "Spend is sales less official fees. We call it spend." | Apr 27 Part 5 |
| R15 | Any EMOS raised in Xero must have matching cost; missing → query required | "Any time an EMOS is raised in Xero, we should be able to see have we got the correct cost" | Apr 27 Part 7 |
| R16 | "No reconciliation → no payment" | verbatim | Persofi Flow memo |
| R17 | Job is closed when invoiced, not when work delivered | "For us it's closed when it's invoiced." | Apr 27 Part 3 |
| R18 | Invoiced = sales invoice raised; Cost = supplier bill received | "Invoiced — is good and implies it is invoiced — Cost — is actual supplier invoice received" | Apr 16 WhatsApp |

---

## Prioritized Backlog

### P0 — Blocks Current Usage

| ID | Item | Evidence | Status |
|---|---|---|---|
| B01 | **Invoice# + amount match must override date** — eliminates most false positives | Magallem doc: "If the invoice number and amount match, date differences should be ignored" | ❓ |
| B02 | **Paid invoices must not appear as variance** — separate "paid but still on statement" category | May 4 WhatsApp, Apr 30 meeting | ❓ |
| B03 | **Supplier alias/name mapping** — statement uploads don't attach to correct supplier | KHIP/Khaled case: Apr 16 docs | ❓ |
| B04 | **Multi-currency per supplier** — statement in EUR + GBP mixed | Hepworth case: Apr 29; "it's ignoring a lot of stuff" | ❓ |
| B05 | **Statement auto-reconcile on upload** — upload should trigger reconciliation automatically | Apr 30 [09:53]: "that should be reconciled automatically, correct?" | ❓ |
| B06 | **Global refresh after upload** — recon state must update after statement upload | May 5 WhatsApp: "should be a global refresh after upload" | ❓ |
| B07 | **Excel export broken for Jeffrey's use** — amounts as text, no currency column, no project ref | Apr 16 doc, Apr 22 WhatsApp | ❓ |
| B08 | **Suppliers missing count logic** — false high count of "missing in Xero" | Apr 27 Part 7: "why would I miss in part 52 — that's like a high number" | ❓ |

### P1 — High Value, Explicitly Specified Multiple Times

| ID | Item | Evidence |
|---|---|---|
| F01 | **date_paid column** on reconciliation view | Apr 30 [10:13:12]: "maybe you can have another column: your date paid" |
| F02 | **Payment run button** — tickable selection, 25th of month | Apr 30 [10:19:24]: "I should get a button — the payment run, tickable action to pay" |
| F03 | **Variance breakdown panel** — statement total / Xero total / explained / unexplained = 0 | Apr 30 [10:35:57]: "I want to see it almost in the Excel. It should be zero." |
| F04 | **Supplier watchlist with "no statement received" flag** | Apr 16 WhatsApp + Apr 30 [10:39:24] |
| F05 | **Manual "mark as reconciled" override** for difficult cases | Apr 16 WhatsApp: "We need to have override — mark as reconciled feature for difficult cases" |
| F06 | **Request missing invoices email template** | Magallem doc: "Two outputs when reconciling: request missing invoices, and payment" |
| F07 | **Suggested payment column** with last-payment-date | Docs: "add another column: suggested payment. From this, we start to build out the payment" |
| F08 | **Supplier comments/notes on portal** — free text + completed/pending status flag | May 7 WhatsApp: "write comments or mark this reconciled reviewed" |
| F09 | **Statement completeness flag** — warn when statement date appears stale | Apr 23 WhatsApp: "this statement is only to 31 Dec, which should be flagged" |
| F10 | **Manual refresh button** | Apr 30 [10:30:10]: "Can I maybe have a button say refresh manually?" |
| F11 | **Bulk export: all missing invoices across all suppliers** | Apr 22 WhatsApp: "do we have a feature to export all missing across all suppliers to Excel?" |
| F12 | **Delete/reset individual statement lines** | Apr 23 WhatsApp: "Magallan which is picking a balance line" |
| F13 | **KPI tiles**: Total Suppliers Owed / Suggested Payments Due / Invoices Not Received / Statements Not Received | Apr 28 WhatsApp: "more meaningful KPIs" |
| F14 | **Clickable KPI tiles** → drill into underlying list | Apr 28 WhatsApp: "when I click on 29 it shows me the ones for further review" |
| F15 | **Separate chat views**: Finance / Ops / Sales | Apr 27 Part 7 [22:32:41] |

### P2 — Architecture Mandates

| ID | Item | Evidence |
|---|---|---|
| A01 | **`client_id` on every record** — multi-tenant foundation before any other work | May 5 architecture doc: explicit mandate |
| A02 | **Xero = core (always). Plunet = optional module** | May 5 architecture doc |
| A03 | **System is read-only against Xero/Plunet** — never writes | May 5 architecture doc |
| A04 | **Sprint order**: Master DB → AP Engine → Revenue Light → Plunet full | May 5 architecture doc |
| A05 | **Light Version (Xero-only) is Stage 1 commercial product** — don't block on Plunet | May 5 architecture doc |

### P3 — Product Vision (Stage 2–3)

| ID | Item | Evidence |
|---|---|---|
| V01 | **Portfolio → Client → Patent drill-down** (B2B law firm layer) | Apr 15 [11:21–11:24] + screenshot mockup |
| V02 | **Email agent on orders inbox** — reads email, creates job listing | Apr 27 Part 5 [22:56:35] |
| V03 | **Post-prosecution classification** — flag by job number age or INS prefix | Apr 27 Parts 5+7 |
| V04 | **Commission calculator** — Gross profit broken down by category (excl. official fees) | Apr 28 WhatsApp |
| V05 | **Payment execution via Wise** — batch file from approved decisions | Persofi Flow memo |
| V06 | **Supplier tone detection** — escalating chase emails shift payment priority | Persofi Flow memo |
| V07 | **Recharge completeness module** — surfaces unbilled costs, WIP accruals | Persofi Flow memo |
| V08 | **Invoice-to-order weekly check** — all EMOS in Plunet last month agreed to orders? | Apr 27 Part 5 [22:52:56] |

---

## The 8-Module Persofi Flow

From the Apr 20 Persofi Flow memo — Jeffrey's full product vision:

```
01 Emails       → automated statement request sent 1st of month
02 Statements   → supplier uploads, auto-extracted, auto-reconciled
03 Invoices     → Plunet → Dokka → Xero (EMOS flow)
04 Reconciliation → match, flag exceptions, produce variance=0 confirmation
05 Decision     → payment recommendations, Jeffrey decides what to pay
06 Wise         → batch payment execution, confirmations back into system
07 Recharge     → surfaces unbilled costs, WIP gaps, missing recharges
08 Profit       → margin by category, completeness indicators, CFO close
```

**The promise:** *"This is complete. This is correct. Now I can decide."*

---

## Product Positioning (Jeffrey's own words)

> *"Persofi doesn't just chase invoices. We find revenue you never billed."*

> *"They move money. You reconstruct economic reality."* — vs Tipalti/Melio

> *"Month-end becomes boring (by design). Because everything is already reconciled."*

> *"This is not a reporting issue. It is a process breakdown across 3 areas."*

> *"You are NOT building a Xero add-on or a Plunet plugin. You ARE building a multi-tenant financial control platform."* — May 5 architecture doc

---

## Emotional Arc

| Date | Signal | Quote |
|---|---|---|
| Mar 31 | Warm opening | "Great start. Chag Sameach." |
| Apr 9 | Hard stop | "I want to pause all micro adjustments until we are all assigned on scope." |
| Apr 14 | Re-engagement | "That is a brilliant start." |
| Apr 17 | Concern | "Currently, we not even get a simple supplier reconciliation correct." |
| Apr 23 | Dissatisfaction | "This version is just too much effort to use. Talk to Itzhak." |
| Apr 28 | Frustration peak | "The login errors is costing me a lot of time and frustration." / "Beyond irritating." |
| May 1 | Recovery | "Really good progress so far." |
| May 4 | Architectural reframe | "It's not only bugs, but structure." |
| May 7 | Validation | "Good news — the recon logic is now solid." |
| May 10 | Strategic reset | "Pause Plunet. Focus on Xero logic. Solve real operational pain points." |

---

*Generated from vita l1_events corpus. All quotes are exact, with timestamps traceable to source events.*
