/**
 * Test suite for claudeCodeJsonl extractor.
 *
 * Strategy: synthetic JSONL fixture with all the cases — text turns, tool_use,
 * system messages, malformed lines, empty lines. Mock the ExtractorContext.
 * Assert events come out shaped correctly for both facets, determinism holds,
 * line numbers point to source lines, malformed input is skipped silently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { claudeCodeJsonl } from './claudeCodeJsonl.ts';
import type {
  ExtractionRun,
  ExtractorContext,
  L0Artifact,
  L1EventInsert,
} from '../types.ts';

// ────────────────────────────────────────────────────────────────────
// Fixture — synthetic JSONL covering the cases we care about
// ────────────────────────────────────────────────────────────────────

const FIXTURE_JSONL = [
  // line 1 — user text turn
  '{"type":"user","message":{"role":"user","content":"Hello, can you help me with React?"},"uuid":"u1","timestamp":"2026-05-04T10:00:00Z","sessionId":"s1"}',
  // line 2 — assistant turn with text + tool_use
  '{"type":"assistant","message":{"role":"assistant","model":"claude-opus-4-7","stop_reason":"tool_use","content":[{"type":"text","text":"Sure, I can help."},{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/foo.tsx"}}]},"uuid":"a1","parentUuid":"u1","timestamp":"2026-05-04T10:00:05Z"}',
  // line 3 — system message (should be skipped — neither user nor assistant)
  '{"type":"system","message":{"role":"system","content":"system message ignored"},"uuid":"s1","timestamp":"2026-05-04T10:00:10Z"}',
  // line 4 — malformed JSON (must be skipped silently)
  '{this is not valid json',
  // line 5 — empty line (must be skipped)
  '',
  // line 6 — second user turn
  '{"type":"user","message":{"role":"user","content":"Thanks!"},"uuid":"u2","parentUuid":"a1","timestamp":"2026-05-04T10:00:15Z"}',
  // line 7 — assistant turn with content as plain string (no array)
  '{"type":"assistant","message":{"role":"assistant","model":"claude-sonnet-4-6","content":"You\'re welcome!"},"uuid":"a2","parentUuid":"u2","timestamp":"2026-05-04T10:00:18Z"}',
  // line 8 — assistant turn with ONLY a tool_use (no text — turn_text should skip; tool_calls should yield)
  '{"type":"assistant","message":{"role":"assistant","model":"claude-opus-4-7","content":[{"type":"tool_use","id":"tu2","name":"Bash","input":{"command":"ls"}}]},"uuid":"a3","parentUuid":"a2","timestamp":"2026-05-04T10:00:20Z"}',
].join('\n');

const ARTIFACT: L0Artifact = {
  id: 'art-1',
  tenant_id: 'tnt-1',
  source_type: 'claude_code_jsonl',
  source_uri: '/Users/mordechai/.claude/projects/-Users-mordechai-viter-workspace-Vita-Platform/abc.jsonl',
  sha256: 'fakehash',
  bytes: FIXTURE_JSONL.length,
  origin_at: '2026-05-04T10:00:00Z',
  captured_at: '2026-05-04T10:01:00Z',
  storage_url: null,
  inline_text: FIXTURE_JSONL,
  metadata: { user_canonical_id: 'mordechai-potash' },
};

const RUN_TURN_TEXT: ExtractionRun = {
  id: 'run-tt',
  tenant_id: 'tnt-1',
  artifact_id: 'art-1',
  facet: 'turn_text',
  extractor: 'jsonl-turns-v1',
  version: '0.1.0',
  parameters: {},
  is_deterministic: true,
  status: 'running',
};

const RUN_TOOL_CALLS: ExtractionRun = { ...RUN_TURN_TEXT, id: 'run-tc', facet: 'tool_calls' };

const CTX: ExtractorContext = {
  async resolveActor(canonicalId) {
    const map: Record<string, string> = {
      'mordechai-potash': 'p-mord',
      'claude-opus-4-7': 'p-opus',
      'claude-sonnet-4-6': 'p-sonnet',
    };
    return map[canonicalId] ?? null;
  },
  async resolveChannel(kind, identifier) {
    if (kind === 'claude-code') return `ch-${identifier}`;
    return null;
  },
  async fetchContent(artifact) {
    if (artifact.inline_text !== null) return artifact.inline_text;
    throw new Error('no content for artifact');
  },
};

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

async function collect(it: AsyncIterable<L1EventInsert>): Promise<L1EventInsert[]> {
  const out: L1EventInsert[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

function eventAt(events: L1EventInsert[], i: number): L1EventInsert {
  const e = events[i];
  if (!e) throw new Error(`expected event at index ${i}, got undefined (have ${events.length})`);
  return e;
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

test('turn_text: 3 text turns extracted (user/assistant/user/assistant), system + malformed skipped', async () => {
  const events = await collect(claudeCodeJsonl(ARTIFACT, RUN_TURN_TEXT, CTX));

  // Lines 1, 2, 6, 7 produce text turns. Line 3 system, line 4 malformed, line 5 empty,
  // line 8 has only a tool_use (no text) — also skipped for turn_text.
  assert.equal(events.length, 4, `expected 4 turn_text events; got ${events.length}`);

  const e0 = eventAt(events, 0);
  assert.equal(e0.facet, 'turn_text');
  assert.equal(e0.modality, 'text');
  assert.equal(e0.actor_id, 'p-mord');
  assert.equal(e0.content, 'Hello, can you help me with React?');
  assert.equal(e0.line_no, 1);
  assert.equal(e0.position, 0);
  assert.equal(e0.extraction_method, 'jsonl-turns-v1');

  const e1 = eventAt(events, 1);
  assert.equal(e1.actor_id, 'p-opus');
  assert.equal(e1.content, 'Sure, I can help.');
  assert.equal(e1.line_no, 2);

  const e2 = eventAt(events, 2);
  assert.equal(e2.actor_id, 'p-mord');
  assert.equal(e2.content, 'Thanks!');
  assert.equal(e2.line_no, 6);

  const e3 = eventAt(events, 3);
  assert.equal(e3.actor_id, 'p-sonnet');
  assert.equal(e3.content, "You're welcome!");
  assert.equal(e3.line_no, 7);
});

test('tool_calls: each tool_use becomes one event; metadata carries id/name/input', async () => {
  const events = await collect(claudeCodeJsonl(ARTIFACT, RUN_TOOL_CALLS, CTX));

  // Line 2 has 1 tool_use, line 8 has 1 tool_use → 2 total
  assert.equal(events.length, 2, `expected 2 tool_call events; got ${events.length}`);

  const e0 = eventAt(events, 0);
  assert.equal(e0.facet, 'tool_calls');
  assert.equal(e0.modality, 'tool_call');
  assert.equal(e0.content, 'Read');
  assert.equal(e0.actor_id, 'p-opus');
  assert.equal(e0.line_no, 2);

  const meta0 = e0.metadata;
  assert.equal(meta0.tool_use_id, 'tu1');
  assert.equal(meta0.tool_name, 'Read');
  assert.deepEqual(meta0.tool_input, { file_path: '/foo.tsx' });

  const e1 = eventAt(events, 1);
  assert.equal(e1.content, 'Bash');
  assert.equal(e1.line_no, 8);
  const meta1 = e1.metadata;
  assert.deepEqual(meta1.tool_input, { command: 'ls' });
});

test('positions are monotonic within a single run', async () => {
  const events = await collect(claudeCodeJsonl(ARTIFACT, RUN_TURN_TEXT, CTX));
  for (let i = 1; i < events.length; i++) {
    const prev = eventAt(events, i - 1);
    const cur = eventAt(events, i);
    assert.ok(cur.position > prev.position, `position not monotonic at i=${i}`);
  }
});

test('determinism: same (artifact, run) produces identical event stream', async () => {
  const a = await collect(claudeCodeJsonl(ARTIFACT, RUN_TURN_TEXT, CTX));
  const b = await collect(claudeCodeJsonl(ARTIFACT, RUN_TURN_TEXT, CTX));
  assert.deepEqual(a, b);
});

test('channel resolution uses metadata.channel_identifier when present', async () => {
  const artifactWithChannel: L0Artifact = {
    ...ARTIFACT,
    metadata: { ...ARTIFACT.metadata, channel_identifier: 'vita' },
  };
  const events = await collect(claudeCodeJsonl(artifactWithChannel, RUN_TURN_TEXT, CTX));
  const e = eventAt(events, 0);
  assert.equal(e.channel_id, 'ch-vita');
});

test('channel resolution falls back to source_uri parsing', async () => {
  // ARTIFACT.source_uri ends in "...-Vita-Platform/abc.jsonl" → identifier "Vita-Platform"
  const artifactNoMetaChannel: L0Artifact = {
    ...ARTIFACT,
    metadata: { user_canonical_id: 'mordechai-potash' }, // no channel_identifier
  };
  const events = await collect(claudeCodeJsonl(artifactNoMetaChannel, RUN_TURN_TEXT, CTX));
  const e = eventAt(events, 0);
  assert.equal(e.channel_id, 'ch-Vita-Platform');
});

test('event_at falls back to artifact.origin_at when entry has no timestamp', async () => {
  const fixtureNoTs = '{"type":"user","message":{"role":"user","content":"hi"}}';
  const artifact: L0Artifact = {
    ...ARTIFACT,
    inline_text: fixtureNoTs,
  };
  const events = await collect(claudeCodeJsonl(artifact, RUN_TURN_TEXT, CTX));
  assert.equal(events.length, 1);
  const e = eventAt(events, 0);
  assert.equal(e.event_at, ARTIFACT.origin_at);
});

test('unknown LLM model falls back to claude-opus-4-7 actor', async () => {
  const fixtureUnknownModel = '{"type":"assistant","message":{"role":"assistant","model":"some-future-model","content":"hello"},"uuid":"a","timestamp":"2026-05-04T10:00:00Z"}';
  const artifact: L0Artifact = {
    ...ARTIFACT,
    inline_text: fixtureUnknownModel,
  };
  const events = await collect(claudeCodeJsonl(artifact, RUN_TURN_TEXT, CTX));
  assert.equal(events.length, 1);
  const e = eventAt(events, 0);
  assert.equal(e.actor_id, 'p-opus');
});

test('empty inline_text yields zero events', async () => {
  const artifact: L0Artifact = { ...ARTIFACT, inline_text: '' };
  const events = await collect(claudeCodeJsonl(artifact, RUN_TURN_TEXT, CTX));
  assert.equal(events.length, 0);
});

test('extracted text content trims whitespace', async () => {
  const fixture = '{"type":"user","message":{"role":"user","content":"   hello world   "},"uuid":"u","timestamp":"2026-05-04T10:00:00Z"}';
  const artifact: L0Artifact = { ...ARTIFACT, inline_text: fixture };
  const events = await collect(claudeCodeJsonl(artifact, RUN_TURN_TEXT, CTX));
  const e = eventAt(events, 0);
  assert.equal(e.content, 'hello world');
});

test('metadata carries uuid + parentUuid + model + stop_reason', async () => {
  const events = await collect(claudeCodeJsonl(ARTIFACT, RUN_TURN_TEXT, CTX));
  const assistantEvent = eventAt(events, 1); // line 2 — assistant
  const meta = assistantEvent.metadata;
  assert.equal(meta.uuid, 'a1');
  assert.equal(meta.parent_uuid, 'u1');
  assert.equal(meta.model, 'claude-opus-4-7');
  assert.equal(meta.stop_reason, 'tool_use');
});
