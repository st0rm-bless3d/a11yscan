export { scanUrl, closeBrowser, type ScanOptions } from "./scan.js";
export { buildReport, applyFixHints, filterByMinImpact, decideExitCode, meetsThreshold, isImpact, IMPACT_ORDER, type Impact, type ScanReport, type ReportViolation, type ReportNode, type Fix, type ScanSummary, type AxeResults, type AxeRule, } from "./report.js";
export { fixGuidanceFor, type RuleForGuidance } from "./fixhints.js";
export { formatHuman, formatJson, toJson } from "./format.js";
