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
    causal_arc: CheckResult;
    tensions_section: CheckResult;
    decisions_section: CheckResult;
    threads_severity_tagged: CheckResult;
    quotes_tagged: CheckResult;
    load_bearing_quote: CheckResult;
    citations_count: CheckResult;
    no_unresolved: CheckResult;
}
export interface RubricScore {
    checks: RubricChecks;
    score: number;
    max_score: number;
    pass: boolean;
}
export interface ScoreOptions {
    /** Minimum sum of pass=true to consider an L2 a "pass". Default 8/11. */
    passThreshold?: number;
}
export declare function scoreL2(body: string, parsed: ParsedCitations, opts?: ScoreOptions): RubricScore;
//# sourceMappingURL=rubric.d.ts.map