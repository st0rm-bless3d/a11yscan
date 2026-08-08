export { scanUrl, closeBrowser, type ScanOptions } from "./scan.js";
export { buildReport, applyFixHints, filterByMinImpact, decideExitCode, meetsThreshold, isImpact, IMPACT_ORDER, type Impact, type ScanReport, type ReportViolation, type ReportNode, type Fix, type ScanSummary, type AxeResults, type AxeRule, } from "./report.js";
export { fixGuidanceFor, type RuleForGuidance } from "./fixhints.js";
export { formatHuman, formatJson, toJson, sanitizeErrorText, type SanitizeOptions } from "./format.js";
export { classifyLaunchFailure, browserSetupGuidance, resolvePlaywrightCli, playwrightVersion, BrowserSetupError, type LaunchFailureKind, } from "./browser-setup.js";
