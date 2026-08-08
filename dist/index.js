// Library entrypoint for programmatic use (`import { scanUrl } from "a11yscan"`).
// The `a11yscan` binary (cli.ts) is a thin wrapper over this same surface.
export { scanUrl, closeBrowser } from "./scan.js";
export { buildReport, applyFixHints, filterByMinImpact, decideExitCode, meetsThreshold, isImpact, IMPACT_ORDER, } from "./report.js";
export { fixGuidanceFor } from "./fixhints.js";
export { formatHuman, formatJson, toJson } from "./format.js";
//# sourceMappingURL=index.js.map