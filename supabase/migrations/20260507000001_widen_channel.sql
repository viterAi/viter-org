-- Migration 001: Widen sources.channel from enum constraint to free text
-- Run once against the live Supabase instance.

-- Drop the old CHECK constraint
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_channel_check;

-- Set a sensible default so existing INSERT statements without a channel still work
ALTER TABLE sources ALTER COLUMN channel SET DEFAULT 'manual_upload';
