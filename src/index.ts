// Library entrypoint for programmatic use (`import { scanUrl } from "a11yscan"`).
// The `a11yscan` binary (cli.ts) is a thin wrapper over this same surface.
//
// One deliberate difference between the two. `scanUrl`'s `autoInstall` option
// defaults to FALSE here, while the CLI passes true. The first-run browser
// download runs through a synchronous `spawnSync`, which blocks the event loop
// for the length of a ~150MB transfer — fine in a one-shot CLI process, not
// fine in a server that embedded this. Pass `{ autoInstall: true }` explicitly
// if you want the library to install a browser for you.

export { scanUrl, closeBrowser, type ScanOptions } from "./scan.js";
export {
  buildReport,
  applyFixHints,
  filterByMinImpact,
  decideExitCode,
  meetsThreshold,
  isImpact,
  IMPACT_ORDER,
  type Impact,
  type ScanReport,
  type ReportViolation,
  type ReportNode,
  type Fix,
  type ScanSummary,
  type AxeResults,
  type AxeRule,
} from "./report.js";
export { fixGuidanceFor, type RuleForGuidance } from "./fixhints.js";
export { formatHuman, formatJson, toJson, sanitizeErrorText, type SanitizeOptions } from "./format.js";
export {
  classifyLaunchFailure,
  browserSetupGuidance,
  resolvePlaywrightCli,
  playwrightVersion,
  BrowserSetupError,
  type LaunchFailureKind,
} from "./browser-setup.js";
