// Regression: a multi-line upstream error must stay readable, and the one
// line that tells the user what to run must survive.
//
// v0.1.0 rendered `ERROR: ${r.error}` after scan.ts had already applied a
// blind `.slice(0, 200)`. Against Playwright's boxed message that produced:
//
//   ERROR: Could not load the page for scanning (browserType.launch: Executable
//   doesn't exist at /root/.cache/ms-playwright/...
//   ╔═══════════════════════════════════════════).
//
// The border was cut mid-run, "npx playwright install" was thrown away, and
// the output read as corruption. Every fixture below is a REAL string captured
// from Playwright 1.62.1, not a hand-written approximation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeErrorText, formatHuman } from "../src/format.js";
import { browserSetupGuidance } from "../src/browser-setup.js";
import { errorScanReport } from "../src/report.js";

// Captured from `chromium.launch()` in a clean node:22 container with no
// browser installed (playwright 1.62.1).
const MISSING_BROWSER_ERROR =
  "browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell\n" +
  "╔═══════════════════════════╗\n" +
  "║ Looks like Playwright was just installed or updated.       ║\n" +
  "║ Please run the following command to download new browsers: ║\n" +
  "║                                                            ║\n" +
  "║     npx playwright install                                 ║\n" +
  "║                                                            ║\n" +
  "║ <3 Playwright Team                                         ║\n" +
  "╚═══════════════════════════╝";

// Captured from `chromium.launch()` in a clean node:22 container AFTER a
// successful `playwright install chromium` — the browser is present, the OS
// libraries are not. A different failure, and it must read as one.
const MISSING_DEPS_ERROR =
  "browserType.launch: \n" +
  "╔═════════════════════╗\n" +
  "║ Host system is missing dependencies to run browsers. ║\n" +
  "║ Please install them with the following command:      ║\n" +
  "║                                                      ║\n" +
  "║     npx playwright install-deps                      ║\n" +
  "║                                                      ║\n" +
  "║ Alternatively, use apt:                              ║\n" +
  "║     apt-get install libnspr4\\                        ║\n" +
  "║         libnss3\\                                     ║\n" +
  "║         libdbus-1-3\\                                 ║\n" +
  "╚═════════════════════╝";

test("sanitizeErrorText strips box-drawing characters entirely", () => {
  const out = sanitizeErrorText(MISSING_BROWSER_ERROR);
  assert.doesNotMatch(out, /[─-▟]/, "box-drawing characters must not survive sanitising");
});

test("sanitizeErrorText keeps the actionable command from a boxed Playwright error", () => {
  const out = sanitizeErrorText(MISSING_BROWSER_ERROR);
  assert.match(out, /npx playwright install/, "the command the user must run was dropped");
  assert.match(out, /Please run the following command to download new browsers/);
  assert.match(out, /Executable doesn't exist/, "the cause line must still be present");
});

test("sanitizeErrorText drops the blank padding lines inside the box", () => {
  const out = sanitizeErrorText(MISSING_BROWSER_ERROR);
  assert.doesNotMatch(out, /\n\s*\n/, "no blank lines should remain");
  for (const line of out.split("\n")) {
    assert.notEqual(line.trim(), "", "no empty line should be emitted");
  }
});

test("sanitizeErrorText preserves the command even when the message is truncated", () => {
  // maxLines far below the real line count: the head is kept, the middle is
  // elided, but the actionable line must still be there.
  const out = sanitizeErrorText(MISSING_BROWSER_ERROR, { maxLines: 3 });
  assert.match(out, /npx playwright install/, "truncation must never cut the actionable line");
  assert.match(out, /Executable doesn't exist/, "truncation must keep the first line");
  assert.match(out, /\.\.\./, "an elision marker should mark the removed middle");
});

test("sanitizeErrorText keeps the deps command and the apt package list intact", () => {
  const out = sanitizeErrorText(MISSING_DEPS_ERROR);
  assert.match(out, /Host system is missing dependencies/);
  assert.match(out, /npx playwright install-deps/);
  assert.match(out, /apt-get install libnspr4/);
  // The trailing backslash line-continuations are box noise once the border
  // is gone; they should not survive as dangling escapes.
  assert.doesNotMatch(out, /\\$/m, "trailing continuation backslashes should be cleaned");
});

// The other real shape of the deps failure: the dynamic loader failed and
// Playwright dumped its whole launch log, including a single ~1.7KB line of
// Chromium flags. Readability here is the point.
const MISSING_DEPS_RAW_LOG =
  "browserType.launch: Target page, context or browser has been closed\n" +
  "Browser logs:\n\n" +
  "<launching> /root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell " +
  "--disable-field-trial-config --disable-background-networking ".repeat(30) +
  "\n<launched> pid=93\n" +
  "[pid=93][err] /root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell: " +
  "error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory\n" +
  "Call log:\n" +
  "  - [pid=93] <gracefully close start>\n" +
  "  - [pid=93] <kill>\n" +
  "  - [pid=93] <will force kill>\n" +
  "  - [pid=93] exception while trying to kill process: Error: kill ESRCH\n" +
  "  - [pid=93] <process did exit: exitCode=127, signal=null>\n" +
  "  - [pid=93] starting temporary directories cleanup\n" +
  "  - [pid=93] finished temporary directories cleanup\n" +
  "  - [pid=93] <gracefully close end>";

test("formatHuman keeps the root cause of a huge raw launch log", () => {
  const out = formatHuman([errorScanReport("https://example.com/", "example.com", 5, MISSING_DEPS_RAW_LOG)], "minor");
  assert.match(
    out,
    /error while loading shared libraries: libnspr4\.so/,
    "the one diagnostic line in a 2KB log must survive trimming",
  );
  // The 1.7KB flag line must not be dumped verbatim into a terminal.
  for (const line of out.split("\n")) {
    assert.ok(line.length <= 320, `line of ${line.length} chars was not capped: ${line.slice(0, 80)}...`);
  }
});

test("sanitizeErrorText caps a pathologically long non-actionable line", () => {
  const long = "x".repeat(5000);
  const out = sanitizeErrorText(long, { maxLineLength: 100 });
  assert.ok(out.length < 200, `expected a capped line, got ${out.length} chars`);
  assert.match(out, /…$/, "a capped line should end with an ellipsis");
});

test("sanitizeErrorText never shortens a line that names a command", () => {
  const line = `run npx playwright install chromium ${"y".repeat(400)}`;
  const out = sanitizeErrorText(line, { maxLineLength: 50 });
  assert.equal(out, line, "actionable lines must be exempt from the ordinary length cap");
});

// COUNTER-EXAMPLE to the rule above. "Exempt from the cap" must not mean
// "unbounded": a multi-kilobyte log line that merely happens to contain the
// substring `npx ` would otherwise be dumped verbatim into the terminal, which
// is the same unreadable output this module exists to prevent.
test("an actionable-looking line is still bounded, not unbounded", () => {
  const line = `[pid=1] --flag npx ${"z".repeat(4000)}`;
  const out = sanitizeErrorText(line, { maxLineLength: 100 });
  assert.ok(out.length <= 1100, `a 4KB pseudo-command line was not bounded (${out.length} chars)`);
  assert.match(out, /…$/);
});

test("a message made entirely of commands cannot exceed a bounded line count", () => {
  const many = Array.from({ length: 200 }, (_, i) => `npx playwright install step-${i}`).join("\n");
  const out = sanitizeErrorText(many, { maxLines: 5 });
  assert.ok(
    out.split("\n").length <= 11,
    `expected a bounded render, got ${out.split("\n").length} lines from 200 actionable lines`,
  );
});

test("sanitizeErrorText returns a usable string for empty input", () => {
  assert.equal(sanitizeErrorText(""), "Unknown error.");
  assert.equal(sanitizeErrorText("   \n  \n"), "Unknown error.");
});

test("formatHuman renders a boxed error as aligned, readable lines", () => {
  const report = errorScanReport("https://example.com/", "example.com", 12, MISSING_BROWSER_ERROR);
  const out = formatHuman([report], "minor");

  assert.match(out, /^ {2}ERROR: browserType\.launch/m, "first line should sit on the ERROR label");
  assert.match(out, /^ {9}npx playwright install$/m, "continuation lines should be indented under the label");
  assert.doesNotMatch(out, /[─-▟]/, "no box-drawing noise in human output");

  // The v0.1.0 symptom: output that ends mid-border.
  assert.doesNotMatch(out, /═\)\./, "output must not end in a severed box border");
});

// Cross-module contract. browser-setup.ts writes the guidance; format.ts
// decides what to keep. If format.ts's "actionable line" pattern does not
// recognise the command shape browser-setup.ts emits, trimming will silently
// discard the fix — the exact class of bug this release exists to remove.
// This broke once already: the command changed from
// `./node_modules/.bin/playwright install chromium` to an absolute
// `node /.../playwright/cli.js install chromium`, which the old pattern missed.
test("the command in setup guidance survives aggressive truncation", () => {
  for (const kind of ["missing-browser", "missing-host-deps"] as const) {
    const guidance = browserSetupGuidance(kind, { autoInstall: false });
    const commands = guidance
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /\b(install|install-deps)\b/.test(l) && /chromium/.test(l));
    assert.ok(commands.length > 0, `${kind} guidance names no command`);

    const trimmed = sanitizeErrorText(guidance, { maxLines: 2, maxLineLength: 40 });
    for (const cmd of commands) {
      assert.ok(
        trimmed.includes(cmd),
        `truncating ${kind} guidance to 2 lines dropped or shortened the command.\n` +
          `  wanted: ${cmd}\n  got:\n${trimmed}`,
      );
    }
  }
});

test("formatHuman shows the deps failure as a deps failure, not a missing browser", () => {
  const out = formatHuman([errorScanReport("https://example.com/", "example.com", 5, MISSING_DEPS_ERROR)], "minor");
  assert.match(out, /Host system is missing dependencies/);
  assert.match(out, /install-deps/);
  assert.doesNotMatch(out, /Executable doesn't exist/);
});
