// First-run browser bootstrap.
//
// `playwright` is a dependency of this package, but installing the package
// does NOT put a Chromium build on disk. So the command the README and the
// landing page advertise —
//
//     npx github:st0rm-bless3d/a11yscan#<tag> https://example.com
//
// used to fail on every clean machine with Playwright's raw "Executable
// doesn't exist at .../chromium_headless_shell-<rev>" error. The same thing
// happened inside Microsoft's own `mcr.microsoft.com/playwright` CI image,
// because that image preinstalls a DIFFERENT browser revision than the
// Playwright this package resolves.
//
// This module owns the recovery: classify the launch failure, and for the
// missing-browser case download exactly the Chromium build THIS package's
// Playwright wants, then let scan.ts retry once.
//
// Security note. This spawns a child process, so it is a deliberately narrow
// surface:
//   * the interpreter is `process.execPath` (absolute, our own Node);
//   * the script is resolved by absolute path out of the `playwright` package
//     that OUR module graph resolves, and is rejected unless it sits inside
//     that package directory;
//   * arguments are a fixed literal array, never a template string;
//   * `shell: false`, so nothing is word-split or glob-expanded.
// No scan URL, CLI flag, or a11yscan config value reaches the argv, so a scan
// target cannot influence what gets executed.
//
// One thing that IS inherited, stated precisely because the next reader will
// trust this comment: the child gets the parent's environment. Playwright's own
// `PLAYWRIGHT_DOWNLOAD_HOST` / `PLAYWRIGHT_*_DOWNLOAD_HOST` therefore still
// choose where the download comes from, and `PLAYWRIGHT_BROWSERS_PATH` still
// chooses where it lands and is later executed from. They are deliberately not
// filtered — a corporate download mirror is a legitimate setup and the README
// documents the cache path. This is not an escalation: anything able to set the
// child's environment already set the parent's, and `NODE_OPTIONS` would have
// compromised this process first.
//
// It also never installs OS packages. `playwright install --with-deps` needs
// root and runs apt; silently doing that as a side effect of an accessibility
// scan would be a far bigger action than "download a browser." The missing
// shared-library case is therefore reported, not fixed, with the exact
// command to run.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath, sep } from "node:path";

/** Why `chromium.launch()` failed, to the extent we can tell from its message. */
export type LaunchFailureKind =
  | "missing-browser" // no matching Chromium build on disk — fixable by downloading one
  | "missing-host-deps" // browser present, OS shared libraries absent — needs root/apt
  | "other"; // anything else; we do not guess

// Checked FIRST. "Host system is missing dependencies" is a distinct failure
// from a missing browser and must never be reported as one: reinstalling the
// browser does not fix it, and telling the user to do that sends them in a
// loop. Note `install-deps` is matched here, not by the browser patterns.
const HOST_DEPS_PATTERNS: RegExp[] = [
  /host system is missing dependencies/i,
  /playwright\s+install-deps/i,
  /error while loading shared libraries/i,
  /cannot open shared object file/i,
  /missing libraries/i,
];

const MISSING_BROWSER_PATTERNS: RegExp[] = [
  /executable doesn'?t exist/i,
  /download new browsers/i,
  /was just installed or updated/i,
  /please run the following command to download/i,
];

export function classifyLaunchFailure(message: string): LaunchFailureKind {
  const msg = String(message ?? "");
  if (HOST_DEPS_PATTERNS.some((re) => re.test(msg))) return "missing-host-deps";
  if (MISSING_BROWSER_PATTERNS.some((re) => re.test(msg))) return "missing-browser";
  return "other";
}

/** Absolute path to the `playwright` package directory THIS module resolves. */
function playwrightPackageDir(): string | null {
  try {
    // `playwright/package.json` is an explicit export of the package, unlike
    // `playwright/cli.js`, which its `exports` map does not expose.
    return dirname(createRequire(import.meta.url).resolve("playwright/package.json"));
  } catch {
    return null;
  }
}

/** Version of the Playwright this package actually resolved (for messages). */
export function playwrightVersion(): string | null {
  const dir = playwrightPackageDir();
  if (!dir) return null;
  try {
    const pkg = JSON.parse(readFileSync(resolvePath(dir, "package.json"), "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * Absolute path to the Playwright CLI inside THIS package's own dependency
 * tree, or null if it cannot be located.
 *
 * Resolving through our own module graph (rather than PATH or a bare `npx
 * playwright`) is half the bug fix: a globally resolved or version-floating
 * Playwright downloads a browser revision that this package's Playwright will
 * not accept, which is precisely why the CI-image case failed.
 */
export function resolvePlaywrightCli(): string | null {
  const pkgDir = playwrightPackageDir();
  if (!pkgDir) return null;
  try {
    const pkg = JSON.parse(readFileSync(resolvePath(pkgDir, "package.json"), "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["playwright"];
    if (typeof rel !== "string" || rel === "") return null;

    const cli = resolvePath(pkgDir, rel);
    // Containment check: a `bin` value is package-controlled data, so refuse
    // anything that escapes the package directory rather than executing it.
    // `resolvePath` normalises `../` first, and the trailing separator stops a
    // sibling-prefix bypass (`/pkg-evil` matching a `/pkg` prefix). The package
    // directory itself is refused too: a `bin` of "." would otherwise resolve to
    // a directory, pass an existence check, and spawn with an opaque EISDIR.
    if (!cli.startsWith(pkgDir + sep)) return null;
    return existsSync(cli) && statSync(cli).isFile() ? cli : null;
  } catch {
    return null;
  }
}

export interface InstallOutcome {
  ok: boolean;
  /** Human-readable reason, present only when `ok` is false. */
  reason?: string;
}

/**
 * Run `playwright install chromium` through the resolved CLI.
 *
 * Child output goes to OUR stderr (fd 2), never stdout: a ~150MB download
 * must show progress, and `--json` consumers must still get parseable JSON on
 * stdout. Browsers only; never `--with-deps` (see module header).
 */
export function installChromium(cliPath: string, timeoutMs = 600_000): InstallOutcome {
  const res = spawnSync(process.execPath, [cliPath, "install", "chromium"], {
    stdio: ["ignore", 2, 2],
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (res.error) {
    const timedOut = (res.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    return { ok: false, reason: timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : res.error.message };
  }
  if (res.signal) return { ok: false, reason: `terminated by signal ${res.signal}` };
  if (res.status !== 0) return { ok: false, reason: `exited with code ${res.status}` };
  return { ok: true };
}

/** Thrown when the browser could not be made to launch. Its message is
 * purpose-written and passed through to the report verbatim — callers must not
 * wrap or truncate it, because it carries the command the user has to run. */
export class BrowserSetupError extends Error {
  readonly kind: LaunchFailureKind;
  constructor(message: string, kind: LaunchFailureKind) {
    super(message);
    this.name = "BrowserSetupError";
    this.kind = kind;
  }
}

export interface GuidanceContext {
  /** Was auto-install permitted for this run? */
  autoInstall: boolean;
  /** Set when an auto-install was attempted and did not succeed. */
  installFailure?: string;
  /** True when this failure came from the retry AFTER a successful install. */
  afterInstall?: boolean;
  /** Playwright's own message, for the "other" case where we cannot do better. */
  upstream?: string;
}

/** Shell-quote a path only if it needs it, so the common case stays readable. */
function quotePath(p: string): string {
  return /[\s"'\\$`]/.test(p) ? `"${p.replace(/(["$`\\])/g, "\\$1")}"` : p;
}

/**
 * A Playwright command the user can actually paste, whatever layout they are in.
 *
 * This must NOT be `./node_modules/.bin/playwright`. Under the advertised
 * `npx github:st0rm-bless3d/a11yscan#<tag> <url>` form, npm installs the
 * package into its own cache directory and runs it with the CALLER's working
 * directory, which usually has no `node_modules` at all. A relative path there
 * fails with "not found" (exit 127) — telling a stuck user to run a command
 * that cannot work. Caught by a cross-family review after the first round of
 * clean-container testing verified only the `npm install` layout.
 *
 * So: prefer the absolute CLI inside a11yscan's own dependency tree, which is
 * valid from any directory. If it cannot be resolved, fall back to a
 * VERSION-PINNED npx command — pinning the version is what pins the browser
 * revision, and an unpinned `npx playwright install` is the mismatch bug.
 */
export function playwrightCommand(args: string[]): string {
  const cli = resolvePlaywrightCli();
  if (cli) return `node ${quotePath(cli)} ${args.join(" ")}`;
  const version = playwrightVersion();
  return `npx playwright@${version ?? "1"} ${args.join(" ")}`;
}

/**
 * The message a user actually sees when we cannot start a browser. Every
 * branch names a concrete command. These strings are hand-written and, per the
 * project's FTC copy constraint, make no compliance claim.
 */
export function browserSetupGuidance(kind: LaunchFailureKind, ctx: GuidanceContext): string {
  const version = playwrightVersion();
  const pw = version ? `Playwright ${version}` : "the Playwright version a11yscan bundles";

  if (kind === "missing-host-deps") {
    return [
      "Chromium is installed, but this system is missing the shared libraries it needs to start.",
      "This is a missing OS package, not a missing browser: installing the browser again will not fix it.",
      "Install the system packages as well (this needs root, so a11yscan will not do it for you):",
      `    ${playwrightCommand(["install", "--with-deps", "chromium"])}`,
      "On Debian or Ubuntu you can install just the packages with:",
      `    ${playwrightCommand(["install-deps", "chromium"])}`,
      "In a container, run that as root before the scan; a plain `node` image does not ship these libraries.",
    ].join("\n");
  }

  if (kind === "missing-browser") {
    const lines = [`a11yscan needs the Chromium build that ${pw} expects, and it is not installed.`];
    if (ctx.installFailure) {
      lines.push(`The automatic download was attempted and failed: ${ctx.installFailure}.`);
    } else if (!ctx.autoInstall) {
      lines.push("The automatic download is switched off for this run (--no-auto-install / A11YSCAN_AUTO_INSTALL=0).");
    }
    lines.push(
      "Install it with the Playwright that ships with a11yscan, so the browser revision matches:",
      `    ${playwrightCommand(["install", "chromium"])}`,
      "That path points at a11yscan's own Playwright, so the revision matches and it runs from any directory.",
    );
    return lines.join("\n");
  }

  const lines = ["a11yscan could not start a browser."];
  if (ctx.upstream) lines.push(ctx.upstream);
  lines.push(
    "If this looks like a browser-installation problem, install Chromium with a11yscan's own Playwright:",
    `    ${playwrightCommand(["install", "--with-deps", "chromium"])}`,
  );
  return lines.join("\n");
}
