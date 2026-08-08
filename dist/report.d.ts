export type Impact = "critical" | "serious" | "moderate" | "minor";
export declare const IMPACT_ORDER: Impact[];
export declare function isImpact(value: string): value is Impact;
export declare function meetsThreshold(impact: Impact, threshold: Impact): boolean;
export interface ReportNode {
    target: string;
    failureSummary: string;
}
export interface Fix {
    text: string;
    source: "llm" | "axe";
}
export interface ReportViolation {
    id: string;
    impact: Impact;
    description: string;
    help: string;
    helpUrl: string;
    wcagTags: string[];
    nodeCount: number;
    nodes: ReportNode[];
    fix: Fix;
}
export interface ScanSummary {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    violationRules: number;
    passes: number;
    incomplete: number;
}
export interface ScanReport {
    url: string;
    hostname: string;
    scannedAt: string;
    durationMs: number;
    summary: ScanSummary;
    violations: ReportViolation[];
    incompleteRules: {
        id: string;
        description: string;
        helpUrl: string;
    }[];
    notes: string[];
    error?: string;
}
export interface AxeRule {
    id: string;
    impact?: string | null;
    description: string;
    help: string;
    helpUrl: string;
    tags?: string[];
    nodes: {
        target: unknown;
        failureSummary?: string;
    }[];
}
export interface AxeResults {
    violations: AxeRule[];
    passes: {
        id: string;
    }[];
    incomplete: AxeRule[];
}
export declare function normalizeImpact(impact: string | null | undefined): Impact;
export declare function safeHttpUrl(u: string): string;
/**
 * axe-core result -> structured report. Pure and synchronous; fix guidance
 * defaults to axe's own help text (source "axe") for every violation. Callers
 * that want LLM-generated hints overlay them afterward with applyFixHints().
 */
export declare function buildReport(url: string, hostname: string, durationMs: number, axe: AxeResults, notes?: string[]): ScanReport;
/** A report shape for a URL that could not be scanned at all (bad URL,
 * navigation failure, timeout). Carries `error` so decideExitCode() treats it
 * as a hard failure distinct from "scanned clean." */
export declare function errorScanReport(url: string, hostname: string, durationMs: number, message: string): ScanReport;
/** Overlay LLM-generated fix text onto a report's violations, by rule id. */
export declare function applyFixHints(report: ScanReport, hints: Map<string, Fix>): ScanReport;
/** Filter a report's violations down to those at/above `minImpact`. Does not
 * mutate summary counts (those describe the full unfiltered scan). */
export declare function filterByMinImpact(violations: ReportViolation[], minImpact: Impact): ReportViolation[];
/**
 * Decide the process exit code across one or more scan reports.
 *   0 — no scan errored, and either --exit-code was not requested or no
 *       violation met the threshold.
 *   1 — --exit-code was requested and at least one violation at/above
 *       minImpact was found in at least one report.
 *   2 — at least one report recorded a scan-level error (bad URL, navigation
 *       failure, timeout, etc.), regardless of --exit-code.
 */
export declare function decideExitCode(reports: ScanReport[], minImpact: Impact, exitCodeRequested: boolean): number;
