-- 012 · Register `whatsapp_message_live` L0 source type for GOWA-streamed live messages.
--
-- This is the L0 source-type registration for messages arriving via the GOWA
-- webhook (one row per WhatsApp message), distinct from the existing
-- `whatsapp_attachment` (zip-batch backfill) source type. Both end up in the
-- same l0_artifacts table; the source_type column distinguishes them so
-- downstream filters can include/exclude live vs. backfill cleanly.
--
-- Default facets mirror what extract-attachment can produce off a single
-- message — text content lands directly as l1_event without an extractor;
-- audio / image / pdf go through the existing extractor pipeline.

insert into public.l0_source_types (source_type, description, default_facets, metadata)
values (
  'whatsapp_message_live',
  'WhatsApp message streamed live via GOWA webhook (single message per row)',
  array['transcription','image_caption','doc_text','reaction','edit'],
  jsonb_build_object(
    'transport', 'gowa',
    'gowa_min_version', 'v8.4.0',
    'webhook_event_types', array['message','message.ack','message.reaction','message.revoke','message.edited']
  )
)
on conflict (source_type) do update set
  description = excluded.description,
  default_facets = excluded.default_facets,
  metadata = excluded.metadata;

-- ─── Idempotency for webhook retries ─────────────────────────────
-- GOWA retries webhooks on 5xx response. We need to dedupe at the row level.
-- l1_events already has uniqueness via (extraction_run_id, position) but the
-- live-message path has no extraction_run for plain text. Add a deferred
-- partial unique index keyed on metadata.gowa_message_id when present.
create unique index if not exists l1_events_gowa_msgid_unique
  on public.l1_events ((metadata->>'gowa_message_id'))
  where metadata ? 'gowa_message_id';

-- ─── L0 idempotency too (same gowa_message_id should produce ≤1 l0_artifact row per tenant) ─
create unique index if not exists l0_artifacts_gowa_msgid_unique
  on public.l0_artifacts (tenant_id, (metadata->>'gowa_message_id'))
  where source_type = 'whatsapp_message_live' and metadata ? 'gowa_message_id';
