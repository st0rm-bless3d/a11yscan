// Regression: the CLI must actually RUN when invoked through a symlinked bin.
//
// npm links `node_modules/.bin/a11yscan` -> `../a11yscan/dist/cli.js`. The
// original entry guard compared `fileURLToPath(import.meta.url)` to
// `process.argv[1]` by string. Through a symlink those differ, so main() never
// ran: the process exited 0 with no output, having scanned nothing. In CI with
// --exit-code that is a false "clean" — the worst possible failure for an
// accessibility gate. Unit tests missed it because they import the module
// directly; only an installed layout reproduces it.
//
// This test builds the symlink layout and asserts the CLI produces real output
// and a real exit code through the link.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DIST_CLI = resolve(import.meta.dirname, "..", "dist", "cli.js");

test("CLI runs when invoked through a symlinked bin (installed layout)", (t) => {
  if (!existsSync(DIST_CLI)) {
    t.skip("dist/cli.js not built; run `npm run build` first");
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "a11yscan-entry-"));
  try {
    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    const link = join(binDir, "a11yscan");
    symlinkSync(DIST_CLI, link);

    // --help exercises the entry path without needing a browser or network.
    const out = execFileSync(process.execPath, [link, "--help"], {
      encoding: "utf8",
      timeout: 30_000,
    });

    assert.ok(
      out.trim().length > 0,
      "CLI produced NO output through a symlinked bin — main() did not run",
    );
    assert.match(out, /a11yscan/, "help output should name the tool");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI exits non-zero on a usage error through a symlinked bin", (t) => {
  if (!existsSync(DIST_CLI)) {
    t.skip("dist/cli.js not built; run `npm run build` first");
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "a11yscan-entry-err-"));
  try {
    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    const link = join(binDir, "a11yscan");
    symlinkSync(DIST_CLI, link);

    let code = 0;
    try {
      // No URL given: a usage error, which must exit 2 — not a silent 0.
      execFileSync(process.execPath, [link], {
        encoding: "utf8",
        timeout: 30_000,
        stdio: "pipe",
      });
    } catch (err) {
      code = (err as { status?: number }).status ?? -1;
    }

    assert.equal(code, 2, "usage error through a symlinked bin must exit 2, not silently 0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
