# Changelog

All notable changes to a11yscan. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are the tags
published on `github.com/st0rm-bless3d/a11yscan`.

## 0.1.1

Fixes a first-run failure that made the advertised one-line command unusable
for anyone who had not already set up Playwright.

### The bug

`npx github:st0rm-bless3d/a11yscan#v0.1.0 https://example.com` failed on a
clean machine, and the README, the `--help` text and the landing page all
presented it as a standalone command. `playwright` is a dependency of the
package, but installing the package does not put a Chromium build on disk, so
the first scan died with:

```
ERROR: Could not load the page for scanning (browserType.launch: Executable
doesn't exist at /root/.cache/ms-playwright/chromium_headless_shell-1234/...
╔═══════════════════════════════════════════).
```

Three separate defects:

- No browser was installed and nothing installed one.
- Playwright's own message includes a box telling you to run
  `npx playwright install`. a11yscan truncated it to 200 characters, which cut
  the box mid-border and threw away the only actionable sentence. What was left
  read as corrupted output.
- The docs described a standalone command that did not exist.

It also failed inside `mcr.microsoft.com/playwright:v1.55.0-noble`, Microsoft's
own CI image with browsers preinstalled, because that image ships a different
browser revision (`chromium_headless_shell-1187`) than this package's resolved
Playwright wants (`chromium_headless_shell-1234`).

Verified in clean containers before release: two runs in a bare `node:22` and
one in the official Playwright CI image, none of which had a matching browser.

### Added

- First-run browser install. When a scan fails because no matching Chromium
  build is present, a11yscan prints a one-line notice on stderr, downloads the
  build its own Playwright expects, and retries the scan once. The download is
  driven by the Playwright CLI resolved out of a11yscan's own `node_modules`
  by absolute path, so the revision always matches. That is what fixes the
  official-CI-image case as well.
- `--no-auto-install` (and `A11YSCAN_AUTO_INSTALL=0`) to force the strict
  behavior: fail with exit code 2 and print the command to run, download
  nothing. Set automatically by the GitHub Action, which installs the browser
  in its own step. `--auto-install` forces it back on from the command line.
- A separate, differently-worded failure for missing system libraries.
  Downloading a browser does not fix a missing `libnspr4`, and telling a user
  to reinstall the browser in that case sends them round a loop. a11yscan now
  recognizes both shapes of that failure (Playwright's host-requirements
  warning and the raw dynamic-loader error) and points at
  `playwright install --with-deps chromium`. It does not install OS packages
  itself, because that needs root.
- `CHANGELOG.md`.

### Changed

- Multi-line upstream errors now render readably. Box-drawing characters and
  ANSI escapes are stripped, blank padding is dropped, and over-long lines are
  capped — but any line naming a command is never shortened and never dropped,
  including when the message has to be trimmed. Machine-readable `--json`
  output carries the full untruncated text.
- The scan core no longer truncates error text to 200 characters. The report
  carries the whole message and the formatter decides how much to show.
- README documents what the first run actually does: the download, its size,
  the per-user cache location on each platform, the two-step form for people
  who want control, and the system-library case. `--help` says the same.
- The GitHub Action pins `A11YSCAN_AUTO_INSTALL=0` so a failing install step
  fails at that step rather than becoming a mid-scan download.
- Every command a11yscan prints is now absolute, or version-pinned when the
  local Playwright cannot be resolved. An earlier draft printed
  `./node_modules/.bin/playwright ...`, which does not exist in the caller's
  working directory under the advertised `npx github:...` form — npm installs
  the package into its own cache. That guidance exited 127 for exactly the
  users who most needed it. Found by cross-family review after clean-container
  testing had only covered the `npm install` layout; both the printed commands
  and the `npx` layout are now verified end to end.

### Library note

`scanUrl`'s `autoInstall` option defaults to `false` for programmatic callers
while the CLI passes `true`. The install is a synchronous `spawnSync`, so it
blocks the event loop for the length of the download — acceptable in a one-shot
CLI process, not in a server that embedded the scanner. Pass
`{ autoInstall: true }` explicitly to opt in.

### Unchanged

- The exit-code contract. `0` clean, `1` violations at or above the threshold
  with `--exit-code`, `2` a scan that could not run. A missing or unstartable
  browser is a scan error and still yields `2`, never a clean `0`.
- The scan engine, report building, impact filtering, and the SSRF guard on the
  `--fix-hints` call.

## 0.1.0

Initial release. WCAG scanning CLI and GitHub Action over headless Chromium and
axe-core, prioritized report by impact, optional LLM fix hints, SSRF-guarded
outbound LLM call.
