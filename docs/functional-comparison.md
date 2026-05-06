# Functional Comparison — Gui vs vita

> Functionality only. Not UI, not colors.

---

## Core purpose

| | Gui | vita |
|---|---|---|
| **What it is** | AI-driven dashboard builder over operational data blobs | WhatsApp CRM inbox — ingest, browse, and reply to messages |
| **Primary user action** | Paste a data payload → AI generates a multi-page view | Open a channel → read messages → send a reply |
| **Data origin** | User-pasted markdown / JSON / CSV in a `sources` record | WhatsApp messages ingested via GOWA device adapter |
| **AI role** | Core — OpenRouter plans and fills a component layout | None in current web package |

---

## Authentication

| | Gui | vita |
|---|---|---|
| Auth system | None — app is open to any visitor | Email OTP via Resend + Supabase magic-link |
| Session management | None | `@supabase/ssr` cookie-based sessions |
| Sign-out | None | `POST /auth/signout` |
| Route protection | None | `middleware.ts` redirects to `/login` |

---

## Data model

| Entity | Gui | vita |
|---|---|---|
| Tenants | None — single shared DB | `tenants` + `tenant_members` with RLS |
| Users / identity | None | `principals`, `tenant_members` |
| Core data record | `sources` (key, channel, markdown blob, seed format) | `l0_artifacts` (immutable captures) → `l1_events` (messages, transcriptions, captions) |
| Channels | Column on `sources` (whatsapp / email / portal / manual) | First-class `channels` table with grouping |
| Views / layouts | `views`, `view_versions`, `view_drafts`, `view_events` | None — no persistent layout layer |
| Devices | None | `whatsapp_devices`, `whatsapp_device_health` |

---

## Features

| Capability | Gui | vita |
|---|---|---|
| List and switch sources / channels | Yes | Yes |
| AI page generation (SSE stream) | Yes — plan → fill → render | No |
| Component catalog (charts, KPIs, kanban…) | Yes — 14+ component types | No |
| View persistence and versioning | Schema exists; apply route works; **client never loads views** | N/A |
| Draft approval flow | Schema + API exist; **banner is hardwired dead** | N/A |
| Real-time data updates | No — full reload required | Yes — `postgres_changes` subscription + unread pill |
| Outbound actions / write-back | No — `mark_followed_up` returns HTTP 410 | Yes — send WhatsApp message via GOWA, optimistic insert |
| Media / file handling | No | Yes — signed URL via `/api/media/[artifactId]` |
| Device pairing | No | Yes — GOWA QR pair, unlink, refresh |
| Dashboard / aggregate stats | No | Yes — device health, pipeline counts, recent events |
| Bootstrap / synthetic seed data | Yes — `POST /api/bootstrap` from repo markdown | No |
| Multi-tenant data isolation | No | Yes — all queries scoped by `tenant_id` |

---

## API surface

| Route | Gui | vita |
|---|---|---|
| Auth | None | `/auth/callback`, `/auth/signout` |
| Sources / channels | `GET/POST /api/sources` | Server actions + Supabase direct |
| AI canvas | `GET /api/sources/[sourceId]/canvas` (SSE) | None |
| Row data | `GET /api/sources/[sourceId]/invoices` | `l1_events` via Supabase client |
| Views | `GET/POST /api/sources/[sourceId]/views` | None |
| View actions | `POST /api/views/[viewId]/actions` — **stubbed 410** | Server action `sendChatMessage` |
| Apply draft | `POST /api/views/[viewId]/apply` — works, unreachable | None |
| Media | None | `GET /api/media/[artifactId]` |
| Seed / ops | `POST /api/bootstrap` | None |

---

## Integrations

| | Gui | vita |
|---|---|---|
| Supabase | Yes — service role only, no auth | Yes — service role + SSR cookie auth + Realtime |
| OpenRouter / AI | Yes — page planner + component filler | No |
| WhatsApp (GOWA) | No | Yes — pair, send, device health |
| Email (Resend) | No | Yes — OTP delivery |

---

## What Gui has that vita doesn't

- OpenRouter-driven multi-page AI layout generation
- Component catalog with 14+ block types (charts, KPIs, kanban, tables, entity cards…)
- View versioning and draft approval workflow (schema + API complete)
- Synthetic data bootstrap for repeatable dev/demo environments

## What vita has that Gui doesn't

- End-user authentication
- Multi-tenant data isolation
- Real-time inbound data via Supabase subscriptions
- Outbound actions that actually write back (send message, update status)
- WhatsApp device management
- Media / file serving
- Aggregate operations dashboard
