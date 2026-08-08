/** Why `chromium.launch()` failed, to the extent we can tell from its message. */
export type LaunchFailureKind = "missing-browser" | "missing-host-deps" | "other";
export declare function classifyLaunchFailure(message: string): LaunchFailureKind;
/** Version of the Playwright this package actually resolved (for messages). */
export declare function playwrightVersion(): string | null;
/**
 * Absolute path to the Playwright CLI inside THIS package's own dependency
 * tree, or null if it cannot be located.
 *
 * Resolving through our own module graph (rather than PATH or a bare `npx
 * playwright`) is half the bug fix: a globally resolved or version-floating
 * Playwright downloads a browser revision that this package's Playwright will
 * not accept, which is precisely why the CI-image case failed.
 */
export declare function resolvePlaywrightCli(): string | null;
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
export declare function installChromium(cliPath: string, timeoutMs?: number): InstallOutcome;
/** Thrown when the browser could not be made to launch. Its message is
 * purpose-written and passed through to the report verbatim — callers must not
 * wrap or truncate it, because it carries the command the user has to run. */
export declare class BrowserSetupError extends Error {
    readonly kind: LaunchFailureKind;
    constructor(message: string, kind: LaunchFailureKind);
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
export declare function playwrightCommand(args: string[]): string;
/**
 * The message a user actually sees when we cannot start a browser. Every
 * branch names a concrete command. These strings are hand-written and, per the
 * project's FTC copy constraint, make no compliance claim.
 */
export declare function browserSetupGuidance(kind: LaunchFailureKind, ctx: GuidanceContext): string;
