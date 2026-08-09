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
export { buildReport, normalizeImpact, safeHttpUrl, applyFixHints, filterByMinImpact, decideExitCode, meetsThreshold, isImpact, IMPACT_ORDER, } from "./report.js";
export { fixGuidanceFor } from "./fixhints.js";
export { formatHuman, formatJson, toJson, sanitizeErrorText } from "./format.js";
// Re-exported so a consumer that must dial a validated address (rather than
// re-resolving the hostname and losing the DNS-rebind race) can reuse this
// implementation instead of writing another one. gov-index/ does exactly that
// for its robots.txt fetch and for every main-frame document it fetches on the
// browser's behalf. Additive only: nothing in the CLI's own behaviour changes.
export { pinnedFetch, PinnedFetchError } from "./pinnedfetch.js";
export { classifyLaunchFailure, browserSetupGuidance, resolvePlaywrightCli, playwrightVersion, BrowserSetupError, } from "./browser-setup.js";
//# sourceMappingURL=index.js.map