// Library entrypoint for programmatic use (`import { scanUrl } from "a11yscan"`).
// The `a11yscan` binary (cli.ts) is a thin wrapper over this same surface.
//
// One deliberate difference between the two. `scanUrl`'s `autoInstall` option
// defaults to FALSE here, while the CLI passes true. The first-run browser
// download runs through a synchronous `spawnSync`, which blocks the event loop
// for the length of a ~150MB transfer — fine in a one-shot CLI process, not
// fine in a server that embedded this. Pass `{ autoInstall: true }` explicitly
// if you want the library to install a browser for you.
export { scanUrl, closeBrowser } from "./scan.js";
export { buildReport, applyFixHints, filterByMinImpact, decideExitCode, meetsThreshold, isImpact, IMPACT_ORDER, } from "./report.js";
export { fixGuidanceFor } from "./fixhints.js";
export { formatHuman, formatJson, toJson, sanitizeErrorText } from "./format.js";
export { classifyLaunchFailure, browserSetupGuidance, resolvePlaywrightCli, playwrightVersion, BrowserSetupError, } from "./browser-setup.js";
//# sourceMappingURL=index.js.map