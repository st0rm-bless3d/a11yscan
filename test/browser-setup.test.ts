// The first-run browser bootstrap: classification, CLI resolution, guidance.
//
// The bug this covers: `npx github:st0rm-bless3d/a11yscan#v0.1.0 <url>` failed
// on every clean machine because installing the package does not install a
// browser. It failed a SECOND way inside mcr.microsoft.com/playwright, whose
// preinstalled browser revision does not match this package's Playwright.
//
// The fixtures below are real strings captured from Playwright 1.62.1 in
// clean node:22 containers, not hand-written approximations. Note there are
// TWO shapes of the missing-dependency failure depending on whether
// Playwright's own host-requirements validator runs before the exec: a
// friendly box, or the raw dynamic-loader error. Both must classify the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, sep } from "node:path";
import { existsSync } from "node:fs";
import {
  classifyLaunchFailure,
  browserSetupGuidance,
  resolvePlaywrightCli,
  playwrightVersion,
} from "../src/browser-setup.js";

const MISSING_BROWSER =
  "browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell\n" +
  "╔════════════════════════════════════════════════════════════╗\n" +
  "║ Looks like Playwright was just installed or updated.       ║\n" +
  "║ Please run the following command to download new browsers: ║\n" +
  "║     npx playwright install                                 ║\n" +
  "╚════════════════════════════════════════════════════════════╝";

// Playwright's pre-launch validator caught it.
const MISSING_DEPS_BOXED =
  "browserType.launch: \n" +
  "╔══════════════════════════════════════════════════════╗\n" +
  "║ Host system is missing dependencies to run browsers. ║\n" +
  "║ Please install them with the following command:      ║\n" +
  "║     npx playwright install-deps                      ║\n" +
  "╚══════════════════════════════════════════════════════╝";

// The validator did not run; the dynamic loader failed instead. This is what
// a11yscan actually sees after it auto-installs Chromium on a bare node image.
const MISSING_DEPS_RAW =
  "browserType.launch: Target page, context or browser has been closed\n" +
  "Browser logs:\n\n" +
  "<launched> pid=93\n" +
  "[pid=93][err] /root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell: " +
  "error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory\n" +
  "  - [pid=93] <process did exit: exitCode=127, signal=null>";

test("classifyLaunchFailure: a missing browser build is missing-browser", () => {
  assert.equal(classifyLaunchFailure(MISSING_BROWSER), "missing-browser");
});

test("classifyLaunchFailure: both shapes of the missing-library failure are missing-host-deps", () => {
  assert.equal(classifyLaunchFailure(MISSING_DEPS_BOXED), "missing-host-deps");
  assert.equal(
    classifyLaunchFailure(MISSING_DEPS_RAW),
    "missing-host-deps",
    "the raw dynamic-loader failure is the shape a11yscan sees after auto-install on a bare node image",
  );
});

test("classifyLaunchFailure: a missing library is NEVER reported as a missing browser", () => {
  // The whole point of the distinction: telling a user to reinstall the
  // browser when the real problem is libnspr4 sends them round a loop.
  for (const msg of [MISSING_DEPS_BOXED, MISSING_DEPS_RAW]) {
    assert.notEqual(classifyLaunchFailure(msg), "missing-browser");
  }
});

test("classifyLaunchFailure: unrelated errors are not guessed at", () => {
  assert.equal(classifyLaunchFailure("browserType.launch: Timeout 30000ms exceeded"), "other");
  assert.equal(classifyLaunchFailure(""), "other");
});

test("resolvePlaywrightCli returns an absolute path inside a11yscan's own playwright package", () => {
  const cli = resolvePlaywrightCli();
  assert.ok(cli, "the Playwright CLI must be locatable from this package's own dependency tree");
  assert.ok(cli.startsWith(sep), `expected an absolute path, got ${cli}`);
  assert.ok(existsSync(cli), `resolved CLI does not exist: ${cli}`);
  // Containment: it must sit inside the resolved `playwright` package, not
  // some global or PATH-resolved copy. Resolving a floating Playwright is
  // half the original bug — it downloads a browser revision ours rejects.
  assert.match(dirname(cli), /node_modules[\\/]playwright$/, `CLI escaped the playwright package: ${cli}`);
});

test("playwrightVersion reports the version actually resolved", () => {
  const v = playwrightVersion();
  assert.ok(v, "expected a resolved Playwright version");
  assert.match(v, /^\d+\.\d+\.\d+/);
});

test("guidance for a missing browser names a runnable install command", () => {
  const msg = browserSetupGuidance("missing-browser", { autoInstall: true, installFailure: "exited with code 1" });
  assert.match(msg, /install chromium/);
  assert.match(msg, /exited with code 1/, "the install failure reason should be surfaced");
  assert.doesNotMatch(msg, /--with-deps/, "a missing browser does not need OS packages");
});

// REGRESSION (found by cross-family review, after clean-container testing had
// only exercised the `npm install` layout).
//
// The advertised entry point is `npx github:st0rm-bless3d/a11yscan#<tag> <url>`.
// npm installs the package into its own cache and runs it with the CALLER's
// working directory, which normally contains no `node_modules` at all. Guidance
// that said `./node_modules/.bin/playwright install chromium` therefore handed
// a stuck user a command that exits 127 — verified in a clean container.
//
// The structural property, asserted here rather than the exact string: every
// command a11yscan prints must be runnable from an arbitrary directory.
test("guidance never emits a CWD-relative command", () => {
  for (const kind of ["missing-browser", "missing-host-deps", "other"] as const) {
    for (const ctx of [{ autoInstall: true }, { autoInstall: false }, { autoInstall: true, installFailure: "boom" }]) {
      const msg = browserSetupGuidance(kind, ctx);
      assert.doesNotMatch(
        msg,
        /(^|\s)\.{1,2}\//m,
        `${kind} guidance contains a path relative to the caller's CWD, which npx users do not have:\n${msg}`,
      );
      assert.doesNotMatch(msg, /node_modules\/\.bin/, `${kind} guidance points at a local bin shim`);
    }
  }
});

test("every command in guidance is absolute or version-pinned", () => {
  const msg = browserSetupGuidance("missing-browser", { autoInstall: false });
  const command = msg
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /\binstall chromium$/.test(l));
  assert.ok(command, `no install command found in guidance:\n${msg}`);
  const absolute = /^node\s+\/.+\.js\s+install/.test(command);
  const pinned = /^npx playwright@\d/.test(command);
  assert.ok(absolute || pinned, `command is neither absolute nor version-pinned: ${command}`);
});

test("guidance says so when auto-install was switched off", () => {
  const msg = browserSetupGuidance("missing-browser", { autoInstall: false });
  assert.match(msg, /--no-auto-install/, "the user should be told why nothing was downloaded");
  assert.match(msg, /install chromium/, "it must still name the command that fixes it");
});

test("guidance for missing host deps is a DIFFERENT message and recommends --with-deps", () => {
  const deps = browserSetupGuidance("missing-host-deps", { autoInstall: true });
  const browser = browserSetupGuidance("missing-browser", { autoInstall: true });

  assert.notEqual(deps, browser, "the two failures must not produce the same message");
  assert.match(deps, /--with-deps chromium/);
  assert.match(deps, /install-deps chromium/);
  assert.match(deps, /shared libraries/i);
  // It must actively steer the user away from the wrong fix.
  assert.match(deps, /installing the browser again will not fix it/i);
  assert.match(deps, /needs root/i, "the user should know why a11yscan did not do it automatically");
});

test("guidance never makes a compliance claim (FTC copy constraint)", () => {
  const all = [
    browserSetupGuidance("missing-browser", { autoInstall: true }),
    browserSetupGuidance("missing-host-deps", { autoInstall: true }),
    browserSetupGuidance("other", { autoInstall: true, upstream: "boom" }),
  ].join("\n");
  for (const banned of [/\bcompliant\b/i, /\bcertified\b/i, /\bguarantee/i, /passes WCAG/i]) {
    assert.doesNotMatch(all, banned, `banned marketing phrase ${banned} appeared in setup guidance`);
  }
});
