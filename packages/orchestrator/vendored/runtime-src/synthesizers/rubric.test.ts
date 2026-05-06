import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreL2 } from './rubric.js';
import type { ParsedCitations } from './citation-parser.js';

const PERFECT_BODY = `---
date: 2026-04-29
state_shift: "thing changed"
---

# 2026-04-29 — subject

## State shift

**Before:** old reality.

**After:** new reality.

## TL;DR

Two sentences here. Three.

## What happened

### Seed — pre-dawn

Stuff happened [e1].

### Response — morning

More stuff [e2, e3].

### Lockin — afternoon

Big decision [e4].

### Close — evening

Wrapped [e5].

## Tensions / contradictions

A vs B [e6].

## Decisions made (strategic)

- decision one [e7]
- decision two [e8]
- decision three [e9]
- decision four [e10]

## Open threads

- \`[blocker]\` thing one [e11]
- \`[open]\` thing two [e12]
- \`[philosophical]\` thing three [e13]

## Quotes worth preserving

\`[seed]\` *"a"* [e14]
\`[framework]\` *"b"* [e15]
\`[decision]\` *"c"* [e16]
\`[mode-invoke]\` *"d"* [e17]
\`[self-correction]\` *"e"* [e18]

## The load-bearing quote of the day

> *"this captures it"* — Speaker [e19]
`;

function fakeParsed(citedN: number, unresolvedN: number = 0): ParsedCitations {
  return {
    cited_event_ids: Array.from({ length: citedN }, (_, i) => `aaaa${i}`),
    cited_extraction_runs: ['rrr1'],
    unresolved_codes: Array.from({ length: unresolvedN }, (_, i) => `e${999 + i}`),
    all_codes: [],
  };
}

test('scoreL2: perfect body scores 11/11 and passes', () => {
  const r = scoreL2(PERFECT_BODY, fakeParsed(20, 0));
  assert.equal(r.max_score, 11);
  assert.equal(r.score, 11);
  assert.equal(r.pass, true);
});

test('scoreL2: missing TL;DR knocks 1 point', () => {
  const r = scoreL2(PERFECT_BODY.replace('## TL;DR', '## DropMe'), fakeParsed(20));
  assert.equal(r.score, 10);
  assert.equal(r.checks.tldr.pass, false);
});

test('scoreL2: < 15 citations fails citations_count', () => {
  const r = scoreL2(PERFECT_BODY, fakeParsed(10));
  assert.equal(r.checks.citations_count.pass, false);
});

test('scoreL2: hallucinated codes fail no_unresolved', () => {
  const r = scoreL2(PERFECT_BODY, fakeParsed(20, 2));
  assert.equal(r.checks.no_unresolved.pass, false);
  assert.equal(r.checks.no_unresolved.note, 'e999,e1000');
});

test('scoreL2: < 3 phase headings fails causal_arc', () => {
  const stripped = PERFECT_BODY.replace(/### Lockin[\s\S]*?### Close/, '');
  const r = scoreL2(stripped, fakeParsed(20));
  assert.equal(r.checks.causal_arc.pass, false);
});

test('scoreL2: missing tagged quotes fails quotes_tagged', () => {
  const noQuotes = PERFECT_BODY.replace(/\[(seed|framework|decision|mode-invoke|self-correction)\]/g, '[other]');
  const r = scoreL2(noQuotes, fakeParsed(20));
  assert.equal(r.checks.quotes_tagged.pass, false);
});

test('scoreL2: passThreshold can be tuned', () => {
  const r = scoreL2(PERFECT_BODY.replace('## TL;DR', '## DropMe'), fakeParsed(20), { passThreshold: 11 });
  assert.equal(r.pass, false);
});
