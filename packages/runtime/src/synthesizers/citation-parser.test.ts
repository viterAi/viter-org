import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractCodes, resolveCitations, type CitedEventMap } from './citation-parser.js';

const MAP: CitedEventMap = {
  codeToId: new Map([
    ['e1', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    ['e2', 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ['e3', 'cccc3333-cccc-cccc-cccc-cccccccccccc'],
  ]),
  codeToRunId: new Map([
    ['e1', 'rrrr1111-rrrr-rrrr-rrrr-rrrrrrrrrrrr'],
    ['e2', 'rrrr1111-rrrr-rrrr-rrrr-rrrrrrrrrrrr'],
    ['e3', 'rrrr2222-rrrr-rrrr-rrrr-rrrrrrrrrrrr'],
  ]),
};

test('extractCodes: single citation', () => {
  const codes = extractCodes('Mordechai said hello [e1].');
  assert.deepEqual(codes, ['e1']);
});

test('extractCodes: multi-citation [e1, e2]', () => {
  const codes = extractCodes('Two events [e1, e2] support this.');
  assert.deepEqual(codes, ['e1', 'e2']);
});

test('extractCodes: no spaces [e1,e2,e3]', () => {
  const codes = extractCodes('Three [e1,e2,e3].');
  assert.deepEqual(codes, ['e1', 'e2', 'e3']);
});

test('extractCodes: dedupes across multiple citations', () => {
  const codes = extractCodes('First [e1] and again [e1, e2] and [e2].');
  assert.deepEqual(codes, ['e1', 'e2']);
});

test('extractCodes: ignores non-eN brackets', () => {
  const codes = extractCodes('A list [1, 2] and [foo] but real [e5].');
  assert.deepEqual(codes, ['e5']);
});

test('extractCodes: sorted numerically not lexically', () => {
  const codes = extractCodes('[e10] [e2] [e1]');
  // numerically sorted: e1, e2, e10
  assert.deepEqual(codes, ['e1', 'e2', 'e10']);
});

test('resolveCitations: maps codes to event_ids and run_ids, dedups runs', () => {
  const body = 'A claim [e1, e2] and another [e3].';
  const result = resolveCitations(body, MAP);
  assert.deepEqual(result.cited_event_ids, [
    'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'cccc3333-cccc-cccc-cccc-cccccccccccc',
  ]);
  // e1 + e2 share rrrr1111; e3 is rrrr2222 → 2 distinct runs
  assert.deepEqual(result.cited_extraction_runs.sort(), [
    'rrrr1111-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
    'rrrr2222-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
  ]);
  assert.deepEqual(result.unresolved_codes, []);
});

test('resolveCitations: surfaces unresolved (hallucinated) codes', () => {
  const body = 'Real [e1] but fake [e99] and [e100, e1].';
  const result = resolveCitations(body, MAP);
  assert.deepEqual(result.cited_event_ids, ['aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa']);
  assert.deepEqual(result.unresolved_codes.sort(), ['e100', 'e99']);
});

test('resolveCitations: empty body → empty result', () => {
  const result = resolveCitations('No citations here.', MAP);
  assert.deepEqual(result.cited_event_ids, []);
  assert.deepEqual(result.cited_extraction_runs, []);
  assert.deepEqual(result.unresolved_codes, []);
});
