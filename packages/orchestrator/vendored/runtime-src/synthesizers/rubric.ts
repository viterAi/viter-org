/**
 * Programmatic rubric scorer for L2 day syntheses.
 *
 * 11 mechanical checks. Subjective items (narrative quality, contradiction depth)
 * deferred — caller can override `checks.narrative` etc. by hand later.
 *
 * Each check returns { pass, value, note? }. Score = sum(pass) / total weight.
 */

import type { ParsedCitations } from './citation-parser.js';

export interface CheckResult {
  pass: boolean;
  value?: unknown;
  note?: string;
}

export interface RubricChecks {
  yaml_frontmatter: CheckResult;
  before_after: CheckResult;
  tldr: CheckResult;
  causal_arc: CheckResult;            // ≥ 3 phase headings
  tensions_section: CheckResult;
  decisions_section: CheckResult;     // present (count is value)
  threads_severity_tagged: CheckResult;
  quotes_tagged: CheckResult;         // ≥ 5 tagged quotes
  load_bearing_quote: CheckResult;
  citations_count: CheckResult;       // ≥ 15 distinct events cited
  no_unresolved: CheckResult;         // 0 unresolved [eN] codes
}

export interface RubricScore {
  checks: RubricChecks;
  score: number;        // count of pass=true (0..11)
  max_score: number;    // 11
  pass: boolean;        // score >= passThreshold
}

const TAGGED_QUOTE_RE = /\[(seed|framework|mode-invoke|self-correction|decision|blocker)\]/g;
const SEVERITY_TAG_RE = /\[(blocker|open|philosophical)\]/g;

const HEADING_RE = /^#{1,3}\s+/m;
const PHASE_HEADING_RE = /^###\s+/gm;
const YAML_BLOCK_RE = /(?:^|\n)---\s*\n[\s\S]*?\n---\s*(?:\n|$)/;

export interface ScoreOptions {
  /** Minimum sum of pass=true to consider an L2 a "pass". Default 8/11. */
  passThreshold?: number;
}

export function scoreL2(
  body: string,
  parsed: ParsedCitations,
  opts: ScoreOptions = {},
): RubricScore {
  const passThreshold = opts.passThreshold ?? 8;
  const lower = body.toLowerCase();

  const yaml = YAML_BLOCK_RE.test(body);
  const yamlHasDate = /^date:\s*\d{4}-\d{2}-\d{2}/m.test(body);
  const yamlHasStateShift = /^state_shift:/m.test(body);

  const beforeAfter = /\*\*Before:\*\*/.test(body) && /\*\*After:\*\*/.test(body);

  const tldr = /^##\s+TL;?DR/im.test(body);

  const phaseCount = (body.match(PHASE_HEADING_RE) ?? []).length;
  const causalArc = phaseCount >= 3;

  const tensionsSection = /^##\s+Tensions/im.test(body) || lower.includes('contradiction');

  const decisionsSection = /^##\s+Decisions/im.test(body);
  const decisionsCount = (body.match(/^##\s+Decisions[\s\S]*?(?=^##\s+|\Z)/m)?.[0] ?? '').match(/^[-*]\s+/gm)?.length ?? 0;

  const severityTagsCount = (body.match(SEVERITY_TAG_RE) ?? []).length;
  const threadsSeverityTagged = severityTagsCount >= 3;

  const taggedQuotes = (body.match(TAGGED_QUOTE_RE) ?? []).length;
  const quotesTaggedOk = taggedQuotes >= 5;

  // Load-bearing quote: a blockquote in the last 600 chars containing a citation
  const tail = body.slice(-600);
  const loadBearingQuote = />\s*\*?["“][\s\S]+?["”]\*?/.test(tail) && /\[e\d+\]/.test(tail);

  const citationsOk = parsed.cited_event_ids.length >= 15;
  const noUnresolved = parsed.unresolved_codes.length === 0;

  const checks: RubricChecks = {
    yaml_frontmatter:        { pass: yaml && yamlHasDate && yamlHasStateShift, value: { yaml, has_date: yamlHasDate, has_state_shift: yamlHasStateShift } },
    before_after:            { pass: beforeAfter, value: beforeAfter },
    tldr:                    { pass: tldr, value: tldr },
    causal_arc:              { pass: causalArc, value: phaseCount, note: `${phaseCount} ### phase headings` },
    tensions_section:        { pass: tensionsSection, value: tensionsSection },
    decisions_section:       { pass: decisionsSection && decisionsCount >= 4, value: decisionsCount, note: `${decisionsCount} bullet decisions` },
    threads_severity_tagged: { pass: threadsSeverityTagged, value: severityTagsCount, note: `${severityTagsCount} severity tags` },
    quotes_tagged:           { pass: quotesTaggedOk, value: taggedQuotes, note: `${taggedQuotes} tagged quotes` },
    load_bearing_quote:      { pass: loadBearingQuote, value: loadBearingQuote },
    citations_count:         { pass: citationsOk, value: parsed.cited_event_ids.length },
    no_unresolved:           { pass: noUnresolved, value: parsed.unresolved_codes.length, note: parsed.unresolved_codes.join(',') || undefined },
  };

  const score = Object.values(checks).filter((c) => c.pass).length;
  const max_score = Object.keys(checks).length;

  return { checks, score, max_score, pass: score >= passThreshold };
}
