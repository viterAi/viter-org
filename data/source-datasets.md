# Source Datasets

This markdown file is the canonical seed input for source metadata and AR invoices.

## Sources

| key | name | channel | description |
| --- | --- | --- | --- |
| wappa_primary | Wappa Primary Inbox | whatsapp | Invoices captured from WhatsApp documents and chat confirmations |
| finance_email | Finance Email Intake | email | Statements and invoices received through AP/AR mailbox ingestion |
| partner_portal | Partner Portal Feed | portal | Exported invoice files synced from supplier web portal |

## Invoices

| source_key | invoice_id | client_name | amount_cents | due_date | status | follow_up_status | assignee |
| --- | --- | --- | --- | --- | --- | --- | --- |
| wappa_primary | INV-1001 | Acme Logistics | 980000 | 2026-04-20 | due_1_30 | todo | maya |
| finance_email | INV-1002 | Northstar Health | 1450000 | 2026-03-18 | due_31_60 | in_progress | jon |
| partner_portal | INV-1003 | Blue Harbor Foods | 470000 | 2026-01-30 | due_61_plus | todo | maya |
| finance_email | INV-1004 | Aster Manufacturing | 320000 | 2026-05-25 | current | followed_up | nora |
| wappa_primary | INV-1005 | Cedar Retail Group | 760000 | 2026-04-04 | due_1_30 | todo | jon |
| partner_portal | INV-1006 | Horizon Clinics | 1240000 | 2026-02-15 | due_31_60 | in_progress | nora |
