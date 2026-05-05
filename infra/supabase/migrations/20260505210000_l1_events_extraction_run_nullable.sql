-- 014 · l1_events.extraction_run_id may be NULL.
--
-- Live webhook events (e.g. WhatsApp text messages from GOWA) come straight
-- from the source — there is no extractor between L0 and L1 for plain text.
-- Forcing a synthetic extraction_run_id added pointless rows and silently
-- broke webhook inserts (NULL violates not-null → 500 in EF, no row).
--
-- After this migration:
--   extraction_run_id IS NOT NULL → row was produced by an extractor (audio,
--                                   image, pdf, etc.) — has provenance to
--                                   l1_extraction_runs
--   extraction_run_id IS NULL     → row is direct-from-source (live webhook,
--                                   raw text input) — provenance lives in
--                                   l1_events.metadata.extraction_method
--                                   instead.

alter table public.l1_events
  alter column extraction_run_id drop not null;

comment on column public.l1_events.extraction_run_id is
  '014 · NULL when the row came directly from a webhook or raw input (e.g. WhatsApp text via GOWA). Use extraction_method + metadata for provenance in that case.';
