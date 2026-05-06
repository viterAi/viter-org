# Autonomous View Builder (v1 Scaffold)

This repository now includes a shell-first Next.js scaffold that persists v1 view-builder state to Supabase.

## Implemented from your decisions

- Next.js runtime with API routes.
- Supabase-backed tables for sources, views, versions, events, and AR invoices.
- Dynamic source-driven views (no demo seed injection).
- Apply flow with version history creation.
- Write-back action flow (`mark_followed_up`) plus invalidation event logging.

## Setup

1. Copy `.env.example` to `.env.local` and fill in Supabase credentials.
2. Run SQL in `supabase/schema.sql` in your Supabase SQL editor.
3. Install dependencies:
   - `npm install`
4. Start app:
   - `npm run dev`

## Useful API calls

- `POST /api/bootstrap`
  - Disabled (returns 410). Add real source data through Supabase instead.
- `GET /api/sources/:sourceId/views`
  - Lists views for a source.
- `POST /api/sources/:sourceId/views`
  - Creates a new view.
- `POST /api/views/:viewId/apply`
  - Applies new spec and records a version entry.
- `POST /api/views/:viewId/actions`
  - Executes write-back action (`mark_followed_up`) and logs view event.
