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
import { realpathSync } from "node:fs";
import { closeBrowser, scanUrl } from "./scan.js";
import { fixGuidanceFor } from "./fixhints.js";
import { applyFixHints, decideExitCode, isImpact, type Impact, type ScanReport } from "./report.js";
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
  --no-auto-install     Do not download Chromium if it is missing. The scan
                         fails with exit code 2 and the command to run
                         instead. Use this in CI that must not pull ~150MB
                         at scan time. Same effect as A11YSCAN_AUTO_INSTALL=0.
  --auto-install        Force the download back on, overriding
                         A11YSCAN_AUTO_INSTALL=0 from the environment.
  -h, --help            Show this help.

First run: a11yscan needs a Chromium build matching its bundled Playwright.
If it is missing, a11yscan downloads it once (about 150MB) and prints a notice
on stderr before starting. It is cached per user (~/.cache/ms-playwright on
Linux, ~/Library/Caches/ms-playwright on macOS), so later runs start straight
away. On a bare container image you may also need Chromium's system libraries;
a11yscan will not install OS packages, but it tells you the command if so.

Examples:
  npx a11yscan https://example.com
  npx a11yscan https://example.com --min-impact serious --exit-code
  npx a11yscan https://example.com --json > report.json
  npx a11yscan https://a.example.com https://b.example.com --fix-hints

Want continuous monitoring across all your sites — scheduled scans, history,
diffs, alerts? Join the waitlist: https://a11yscan.althor.dev
`;

interface ParsedArgs {
  urls: string[];
  json: boolean;
  minImpact: Impact;
  exitCode: boolean;
  fixHints: boolean;
  autoInstall: boolean;
  help: boolean;
}

/** Env default for auto-install, so CI can switch it off without editing the
 * command line. `0`, `false`, `no` and `off` disable it; anything else (and
 * unset) leaves it on. */
export function autoInstallDefault(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env["A11YSCAN_AUTO_INSTALL"];
  if (raw === undefined || raw === "") return true;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ParsedArgs {
  const urls: string[] = [];
  let json = false;
  let minImpact: Impact = "minor";
  let exitCode = false;
  let fixHints = false;
  let autoInstall = autoInstallDefault(env);
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
      case "--no-auto-install":
        autoInstall = false;
        break;
      case "--auto-install":
        autoInstall = true;
        break;
      case "-h":
      case "--help":
        help = true;
        break;
      case "--min-impact": {
        const value = argv[++i];
        if (!value || !isImpact(value)) {
          throw new UsageError(
            `--min-impact requires one of: minor, moderate, serious, critical (got ${JSON.stringify(value ?? "")})`,
          );
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
        } else if (arg?.startsWith("-")) {
          throw new UsageError(`Unknown option: ${arg}`);
        } else if (arg) {
          urls.push(arg);
        }
    }
  }

  return { urls, json, minImpact, exitCode, fixHints, autoInstall, help };
}

export class UsageError extends Error {}

async function main(): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${USAGE}`);
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

  const reports: ScanReport[] = [];
  try {
    for (const url of args.urls) {
      let report = await scanUrl(url, { autoInstall: args.autoInstall });
      if (args.fixHints && !report.error && report.violations.length > 0) {
        const hints = await fixGuidanceFor(
          report.violations.map((v) => ({ id: v.id, description: v.description, help: v.help, impact: v.impact })),
        );
        report = applyFixHints(report, hints);
      }
      reports.push(report);
    }
  } finally {
    await closeBrowser();
  }

  if (args.json) {
    process.stdout.write(formatJson(reports, args.minImpact) + "\n");
  } else {
    process.stdout.write(formatHuman(reports, args.minImpact) + "\n");
  }

  return decideExitCode(reports, args.minImpact, args.exitCode);
}

// Only run when executed directly as the CLI entry, not when imported (e.g.
// by tests exercising parseArgs()) — importing this module must never launch
// a browser, call process.exit(), or otherwise act like a running program.
// Compare REAL paths. When installed, `node_modules/.bin/a11yscan` is a
// symlink, so process.argv[1] is the link path while import.meta.url is the
// resolved file. A naive string compare is false for every installed user,
// which silently skips main() and exits 0 having scanned nothing — a CI gate
// would report "clean" without ever running. Caught by the clean-room install
// test; see test/entrypoint.test.ts.
const isMainModule = ((): boolean => {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  const resolve = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  return resolve(fileURLToPath(import.meta.url)) === resolve(argv1);
})();
if (isMainModule) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`a11yscan: unexpected error: ${(err as Error).stack ?? err}\n`);
      process.exit(2);
    },
  );
}
