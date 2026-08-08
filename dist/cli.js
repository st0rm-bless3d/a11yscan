#!/usr/bin/env node
// a11yscan — WCAG accessibility scanner CLI. See README.md for full usage.
//
// Exit code semantics (documented in full in README "Exit codes"):
//   0  every URL scanned successfully; either --exit-code was not passed, or
//      no violation met --min-impact.
//   1  --exit-code was passed AND at least one scanned URL had a violation
//      at or above --min-impact.
//   2  a usage error (bad flags, no URLs), or at least one URL could not be
//      scanned at all (bad URL, navigation failure, timeout) — checked
//      regardless of --exit-code, because a failed scan is not "clean."
import { fileURLToPath } from "node:url";
import { closeBrowser, scanUrl } from "./scan.js";
import { fixGuidanceFor } from "./fixhints.js";
import { applyFixHints, decideExitCode, isImpact } from "./report.js";
import { formatHuman, formatJson } from "./format.js";
const USAGE = `a11yscan <url> [<url2> ...] [options]

Run a headless-Chromium + axe-core WCAG scan against one or more URLs on
your own machine's network. Same trust model as pa11y/axe-cli: this tool
scans whatever it can reach, same as your browser.

Options:
  --json                Machine-readable JSON output instead of a text report.
  --min-impact <level>  Only report/count violations at or above this impact:
                         minor | moderate | serious | critical.
                         Default: minor (report everything).
  --exit-code           Exit with code 1 if any violation at/above
                         --min-impact was found. Without this flag the
                         process exits 0 regardless of findings (a failed
                         scan itself still exits 2 either way).
  --fix-hints           Ask an OpenAI-compatible LLM (A11YSCAN_LLM_URL /
                         A11YSCAN_LLM_KEY / A11YSCAN_LLM_MODEL) for a short
                         plain-English fix per violation. Falls back to
                         axe's own help text if unset or unreachable.
  -h, --help            Show this help.

Examples:
  npx a11yscan https://example.com
  npx a11yscan https://example.com --min-impact serious --exit-code
  npx a11yscan https://example.com --json > report.json
  npx a11yscan https://a.example.com https://b.example.com --fix-hints

Want continuous monitoring across all your sites — scheduled scans, history,
diffs, alerts? Join the waitlist: https://a11yscan.althor.dev
`;
export function parseArgs(argv) {
    const urls = [];
    let json = false;
    let minImpact = "minor";
    let exitCode = false;
    let fixHints = false;
    let help = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--json":
                json = true;
                break;
            case "--exit-code":
                exitCode = true;
                break;
            case "--fix-hints":
                fixHints = true;
                break;
            case "-h":
            case "--help":
                help = true;
                break;
            case "--min-impact": {
                const value = argv[++i];
                if (!value || !isImpact(value)) {
                    throw new UsageError(`--min-impact requires one of: minor, moderate, serious, critical (got ${JSON.stringify(value ?? "")})`);
                }
                minImpact = value;
                break;
            }
            default:
                if (arg?.startsWith("--min-impact=")) {
                    const value = arg.slice("--min-impact=".length);
                    if (!isImpact(value)) {
                        throw new UsageError(`--min-impact requires one of: minor, moderate, serious, critical (got "${value}")`);
                    }
                    minImpact = value;
                }
                else if (arg?.startsWith("-")) {
                    throw new UsageError(`Unknown option: ${arg}`);
                }
                else if (arg) {
                    urls.push(arg);
                }
        }
    }
    return { urls, json, minImpact, exitCode, fixHints, help };
}
export class UsageError extends Error {
}
async function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    }
    catch (err) {
        process.stderr.write(`${err.message}\n\n${USAGE}`);
        return 2;
    }
    if (args.help) {
        process.stdout.write(USAGE);
        return 0;
    }
    if (args.urls.length === 0) {
        process.stderr.write(`No URL given.\n\n${USAGE}`);
        return 2;
    }
    const reports = [];
    try {
        for (const url of args.urls) {
            let report = await scanUrl(url);
            if (args.fixHints && !report.error && report.violations.length > 0) {
                const hints = await fixGuidanceFor(report.violations.map((v) => ({ id: v.id, description: v.description, help: v.help, impact: v.impact })));
                report = applyFixHints(report, hints);
            }
            reports.push(report);
        }
    }
    finally {
        await closeBrowser();
    }
    if (args.json) {
        process.stdout.write(formatJson(reports, args.minImpact) + "\n");
    }
    else {
        process.stdout.write(formatHuman(reports, args.minImpact) + "\n");
    }
    return decideExitCode(reports, args.minImpact, args.exitCode);
}
// Only run when executed directly as the CLI entry, not when imported (e.g.
// by tests exercising parseArgs()) — importing this module must never launch
// a browser, call process.exit(), or otherwise act like a running program.
const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
    main().then((code) => process.exit(code), (err) => {
        process.stderr.write(`a11yscan: unexpected error: ${err.stack ?? err}\n`);
        process.exit(2);
    });
}
//# sourceMappingURL=cli.js.map