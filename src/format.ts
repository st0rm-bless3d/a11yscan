// Output formatting. Every string here is checked against the FTC copy
// constraint at the source (fixhints.ts's banned-phrase guard covers LLM
// text; the literal strings below are hand-written and must never say
// "compliant", "certified", "guaranteed", or "passes WCAG" — only "detected N
// violations" / "no violations detected by this scan" framing.

import { filterByMinImpact, IMPACT_ORDER, type Impact, type ScanReport, type ReportViolation } from "./report.js";

const IMPACT_LABEL: Record<Impact, string> = {
  critical: "CRITICAL",
  serious: "SERIOUS",
  moderate: "MODERATE",
  minor: "MINOR",
};

function formatViolation(v: ReportViolation): string {
  const lines: string[] = [];
  lines.push(`  [${IMPACT_LABEL[v.impact]}] ${v.id} — ${v.description}`);
  if (v.wcagTags.length > 0) lines.push(`    WCAG: ${v.wcagTags.join(", ")}`);
  lines.push(`    Affected elements (${v.nodeCount}):`);
  for (const n of v.nodes) {
    lines.push(`      - ${n.target}`);
  }
  if (v.nodeCount > v.nodes.length) {
    lines.push(`      ... and ${v.nodeCount - v.nodes.length} more`);
  }
  lines.push(`    Fix: ${v.fix.text}`);
  if (v.helpUrl) lines.push(`    More info: ${v.helpUrl}`);
  return lines.join("\n");
}

export function formatHuman(reports: ScanReport[], minImpact: Impact): string {
  const out: string[] = [];
  for (const r of reports) {
    out.push(`\n${r.url}`);
    if (r.error) {
      out.push(`  ERROR: ${r.error}`);
      continue;
    }
    const shown = filterByMinImpact(r.violations, minImpact);
    out.push(
      `  Detected ${r.summary.violationRules} violation rule(s): ` +
        `${r.summary.critical} critical, ${r.summary.serious} serious, ` +
        `${r.summary.moderate} moderate, ${r.summary.minor} minor. ` +
        `(${r.summary.passes} checks passed, ${r.summary.incomplete} incomplete.)`,
    );
    if (minImpact !== "minor") {
      out.push(`  Showing ${shown.length} at or above "${minImpact}".`);
    }
    if (shown.length === 0) {
      out.push("  No violations detected by this scan at the selected threshold.");
    }
    for (const impact of IMPACT_ORDER) {
      const group = shown.filter((v) => v.impact === impact);
      if (group.length === 0) continue;
      out.push(`\n  -- ${IMPACT_LABEL[impact]} --`);
      for (const v of group) out.push(formatViolation(v));
    }
    for (const note of r.notes) out.push(`  Note: ${note}`);
  }
  out.push(
    "\nThis report reflects only what this scan detected. It is not a compliance " +
      "certification and does not guarantee WCAG conformance.",
  );
  return out.join("\n");
}

export interface JsonViolation {
  id: string;
  impact: Impact;
  tags: string[];
  help: string;
  helpUrl: string;
  description: string;
  nodeCount: number;
  nodes: { selector: string; failureSummary: string }[];
  fix: { text: string; source: "llm" | "axe" };
}

export interface JsonReport {
  url: string;
  hostname: string;
  scannedAt: string;
  durationMs: number;
  error?: string;
  summary: ScanReport["summary"];
  violations: JsonViolation[];
  incompleteRules: ScanReport["incompleteRules"];
  notes: string[];
}

export function toJson(reports: ScanReport[], minImpact: Impact): JsonReport[] {
  return reports.map((r) => ({
    url: r.url,
    hostname: r.hostname,
    scannedAt: r.scannedAt,
    durationMs: r.durationMs,
    ...(r.error ? { error: r.error } : {}),
    summary: r.summary,
    violations: filterByMinImpact(r.violations, minImpact).map((v) => ({
      id: v.id,
      impact: v.impact,
      tags: v.wcagTags,
      help: v.help,
      helpUrl: v.helpUrl,
      description: v.description,
      nodeCount: v.nodeCount,
      nodes: v.nodes.map((n) => ({ selector: n.target, failureSummary: n.failureSummary })),
      fix: v.fix,
    })),
    incompleteRules: r.incompleteRules,
    notes: r.notes,
  }));
}

export function formatJson(reports: ScanReport[], minImpact: Impact): string {
  return JSON.stringify(toJson(reports, minImpact), null, 2);
}
