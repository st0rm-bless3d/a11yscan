// Pure, browser-free report logic: turning raw axe-core results into a
// structured report, filtering by impact, and deciding the process exit code.
// Kept separate from scan.ts (which owns Playwright) so all of this is
// unit-testable without launching a browser.

export type Impact = "critical" | "serious" | "moderate" | "minor";

// Ordered most-to-least severe. Index is used for >= threshold comparisons.
export const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];

export function isImpact(value: string): value is Impact {
  return (IMPACT_ORDER as string[]).includes(value);
}

// True if `impact` is at or above `threshold` severity (lower index = more
// severe, so "at or above" means "index <= threshold's index").
export function meetsThreshold(impact: Impact, threshold: Impact): boolean {
  return IMPACT_ORDER.indexOf(impact) <= IMPACT_ORDER.indexOf(threshold);
}

export interface ReportNode {
  target: string; // CSS selector path
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
  wcagTags: string[]; // e.g. ["wcag2a", "wcag111"]
  nodeCount: number;
  nodes: ReportNode[]; // capped sample
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
  incompleteRules: { id: string; description: string; helpUrl: string }[];
  notes: string[];
  error?: string; // set instead of violations/summary when the scan itself failed
}

// Minimal shape of axe-core results this module consumes (decoupled from
// @axe-core/playwright's own types so this file has zero dependency on it and
// can be unit-tested with plain fixtures).
export interface AxeRule {
  id: string;
  impact?: string | null;
  description: string;
  help: string;
  helpUrl: string;
  tags?: string[];
  nodes: { target: unknown; failureSummary?: string }[];
}

export interface AxeResults {
  violations: AxeRule[];
  passes: { id: string }[];
  incomplete: AxeRule[];
}

export function normalizeImpact(impact: string | null | undefined): Impact {
  if (impact === "critical" || impact === "serious" || impact === "moderate" || impact === "minor") {
    return impact;
  }
  return "minor";
}

export function safeHttpUrl(u: string): string {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

/**
 * axe-core result -> structured report. Pure and synchronous; fix guidance
 * defaults to axe's own help text (source "axe") for every violation. Callers
 * that want LLM-generated hints overlay them afterward with applyFixHints().
 */
export function buildReport(
  url: string,
  hostname: string,
  durationMs: number,
  axe: AxeResults,
  notes: string[] = [],
): ScanReport {
  const summary = { critical: 0, serious: 0, moderate: 0, minor: 0 };

  const violations: ReportViolation[] = axe.violations.map((v) => {
    const impact = normalizeImpact(v.impact);
    summary[impact] += 1;
    return {
      id: v.id,
      impact,
      description: v.description,
      help: v.help,
      helpUrl: safeHttpUrl(v.helpUrl),
      wcagTags: (v.tags ?? []).filter((t) => t.startsWith("wcag")),
      nodeCount: v.nodes.length,
      nodes: v.nodes.slice(0, 5).map((n) => ({
        target: Array.isArray(n.target) ? n.target.join(" ") : String(n.target),
        failureSummary: (n.failureSummary ?? "").slice(0, 800),
      })),
      fix: { text: v.help, source: "axe" },
    };
  });

  // Sort by impact severity, then by number of affected nodes desc.
  violations.sort((a, b) => {
    const d = IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact);
    return d !== 0 ? d : b.nodeCount - a.nodeCount;
  });

  return {
    url,
    hostname,
    scannedAt: new Date().toISOString(),
    durationMs,
    summary: {
      ...summary,
      violationRules: axe.violations.length,
      passes: axe.passes.length,
      incomplete: axe.incomplete.length,
    },
    violations,
    incompleteRules: axe.incomplete.slice(0, 20).map((i) => ({
      id: i.id,
      description: i.description,
      helpUrl: safeHttpUrl(i.helpUrl),
    })),
    notes,
  };
}

/** A report shape for a URL that could not be scanned at all (bad URL,
 * navigation failure, timeout). Carries `error` so decideExitCode() treats it
 * as a hard failure distinct from "scanned clean." */
export function errorScanReport(url: string, hostname: string, durationMs: number, message: string): ScanReport {
  return {
    url,
    hostname,
    scannedAt: new Date().toISOString(),
    durationMs,
    summary: { critical: 0, serious: 0, moderate: 0, minor: 0, violationRules: 0, passes: 0, incomplete: 0 },
    violations: [],
    incompleteRules: [],
    notes: [],
    error: message,
  };
}

/** Overlay LLM-generated fix text onto a report's violations, by rule id. */
export function applyFixHints(report: ScanReport, hints: Map<string, Fix>): ScanReport {
  return {
    ...report,
    violations: report.violations.map((v) => {
      const hint = hints.get(v.id);
      return hint ? { ...v, fix: hint } : v;
    }),
  };
}

/** Filter a report's violations down to those at/above `minImpact`. Does not
 * mutate summary counts (those describe the full unfiltered scan). */
export function filterByMinImpact(violations: ReportViolation[], minImpact: Impact): ReportViolation[] {
  return violations.filter((v) => meetsThreshold(v.impact, minImpact));
}

/**
 * Decide the process exit code across one or more scan reports.
 *   0 — no scan errored, and either --exit-code was not requested or no
 *       violation met the threshold.
 *   1 — --exit-code was requested and at least one violation at/above
 *       minImpact was found in at least one report.
 *   2 — at least one report recorded a scan-level error (bad URL, navigation
 *       failure, timeout, etc.), regardless of --exit-code.
 */
export function decideExitCode(reports: ScanReport[], minImpact: Impact, exitCodeRequested: boolean): number {
  if (reports.some((r) => r.error)) return 2;
  if (!exitCodeRequested) return 0;
  const anyQualifying = reports.some((r) => filterByMinImpact(r.violations, minImpact).length > 0);
  return anyQualifying ? 1 : 0;
}
