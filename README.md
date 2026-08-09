# a11yscan

Open-source WCAG accessibility scanner CLI and GitHub Action. Runs headless
Chromium + [axe-core](https://github.com/dequelabs/axe-core) against one or
more URLs on your own machine's network and prints a prioritized report,
grouped by impact, with WCAG success-criterion tags, CSS selectors, and
axe's help text (or an optional LLM-generated plain-English fix hint).

> Want continuous monitoring across all your sites — scheduled scans,
> history, diffs, alerts? Join the waitlist: `https://a11yscan.althor.dev`

## Install

Published on npm as `@althorlabs/a11yscan`. The scope is not decoration: the
bare name `a11yscan` on npm belongs to an unrelated project, so an unscoped
command would run someone else's package. Every command below is verified
against the published artifact from a container that had never run this tool.

Run without installing:

```bash
npx @althorlabs/a11yscan https://example.com
```

Install as a dev dependency:

```bash
npm install --save-dev @althorlabs/a11yscan
npx a11yscan https://example.com
```

The first run downloads a Chromium build (~115 MB) and caches it. On an image
without Chromium's system libraries, the CLI prints the exact root command to
run first; it will not install OS packages on your behalf.

Installing straight from GitHub also works and is the way to pin a full commit
SHA, which is the strongest guarantee because a tag can be moved:

```bash
npx github:st0rm-bless3d/a11yscan#v0.1.2 https://example.com
npx github:st0rm-bless3d/a11yscan#<full-commit-sha> https://example.com
```

From a clone:

```bash
git clone https://github.com/st0rm-bless3d/a11yscan.git
cd a11yscan
npm install && npm run build
node dist/cli.js https://example.com
```

## What the first run does

a11yscan drives a real Chromium through Playwright, and installing the package
does not put a browser on disk. So the first scan on a new machine downloads
one: about 150MB, once. a11yscan prints a notice on stderr before it starts and
the progress bar comes from Playwright.

The browser is cached per user, not per project:

| Platform | Cache location |
|---|---|
| Linux | `~/.cache/ms-playwright` |
| macOS | `~/Library/Caches/ms-playwright` |
| Windows | `%USERPROFILE%\AppData\Local\ms-playwright` |
| Any (override) | `$PLAYWRIGHT_BROWSERS_PATH` |

Later runs start in a couple of seconds and download nothing. The download is
done by the Playwright that ships inside a11yscan, so the browser revision
always matches the one it expects. A globally resolved `npx playwright install`
can fetch a different revision, which is why using the official
`mcr.microsoft.com/playwright` image was not enough on its own — its
preinstalled browsers are a different build.

### If you would rather control it yourself

Install Chromium ahead of time and nothing is downloaded during a scan:

```bash
npm install --save-dev github:st0rm-bless3d/a11yscan#v0.1.2
./node_modules/.bin/playwright install --with-deps chromium
npx a11yscan https://example.com
```

Use `--no-auto-install` (or `A11YSCAN_AUTO_INSTALL=0`) to make a missing
browser a hard failure instead of a download. The scan then exits `2` and
prints the command to run. This is the right setting for CI that must not pull
150MB at scan time:

```bash
npx a11yscan https://example.com --exit-code --no-auto-install
```

### System libraries

Downloading the browser is not always enough. Chromium needs OS packages
(`libnspr4`, `libnss3`, `libdbus-1-3` and friends) that a bare `node:22` image
does not ship. a11yscan will not install OS packages — that needs root and runs
your package manager — so it reports that case separately and tells you what to
run:

```bash
./node_modules/.bin/playwright install --with-deps chromium   # browser + packages
./node_modules/.bin/playwright install-deps chromium          # packages only
```

Ordinary developer machines (macOS, a desktop Linux install) and the official
`mcr.microsoft.com/playwright` images already have these.

## Usage

```
a11yscan <url> [<url2> ...] [options]
```

| Option | Description |
|---|---|
| `--json` | Machine-readable JSON output instead of a text report. |
| `--min-impact <level>` | Only report/count violations at or above this impact: `minor \| moderate \| serious \| critical`. Default: `minor` (report everything). |
| `--exit-code` | Exit with code `1` if any violation at/above `--min-impact` was found. Without this flag the process always exits `0` on a clean scan run. |
| `--fix-hints` | Ask an OpenAI-compatible LLM for a short plain-English fix per violation. Falls back to axe's own help text if unset or unreachable — never fails the run. |
| `--no-auto-install` | Do not download Chromium if it is missing. The scan fails with exit code `2` and prints the command to run. Same as `A11YSCAN_AUTO_INSTALL=0`. |
| `--auto-install` | Force the first-run download back on, overriding `A11YSCAN_AUTO_INSTALL=0` from the environment. |
| `-h, --help` | Show usage. |

### Exit codes

- **0** — every URL scanned successfully, and either `--exit-code` was not
  passed, or no violation met `--min-impact`.
- **1** — `--exit-code` was passed AND at least one scanned URL had a
  violation at or above `--min-impact`.
- **2** — a usage error (bad flags, no URL given), or at least one URL could
  not be scanned at all (invalid URL, navigation failure, timeout, or a browser
  that could not be installed or started). This is checked regardless of
  `--exit-code` — a failed scan is never reported as "clean."

### Examples

These use the short `npx a11yscan` form, which works once the package is
installed in the project (see "Install"). Without installing, use the full
`npx github:st0rm-bless3d/a11yscan#v0.1.2 ...` form.

Human-readable report, everything shown, always exits 0:

```bash
npx a11yscan https://example.com
```

CI-style gate: fail the build only on serious/critical findings:

```bash
npx a11yscan https://example.com --min-impact serious --exit-code
```

JSON output for piping into another tool:

```bash
npx a11yscan https://example.com --json > report.json
```

Multiple URLs in one run, with LLM fix hints:

```bash
npx a11yscan https://example.com/ https://example.com/checkout --fix-hints
```

### `--fix-hints` configuration

Set these to enable LLM-generated fix suggestions; any OpenAI-compatible
`/v1/chat/completions` endpoint works (LiteLLM, a local Ollama gateway,
OpenAI itself, etc.):

```bash
export A11YSCAN_LLM_URL="https://your-gateway.example.com"   # no trailing /v1/...
export A11YSCAN_LLM_KEY="sk-..."
export A11YSCAN_LLM_MODEL="gpt-4o-mini"
```

If these are unset, `--fix-hints` makes no network call at all and every
violation's fix text is axe-core's own `help` string. If the endpoint is set
but unreachable, times out, or is rejected by the SSRF guard (see
"Security" below), the same axe fallback is used per-violation — a bad or
misconfigured LLM endpoint never fails a scan.

## GitHub Action

Pin a released tag, as shown. For the strongest guarantee pin the full commit
SHA (`st0rm-bless3d/a11yscan@<sha>`) — a tag can be moved, a SHA cannot. Do
not reference the default branch.

```yaml
name: accessibility
on: [pull_request]
jobs:
  a11yscan:
    runs-on: ubuntu-latest
    steps:
      - uses: st0rm-bless3d/a11yscan@v0.1.2
        with:
          url: https://staging.example.com
          min-impact: serious
```

With fix hints (requires the LLM env vars as workflow secrets):

```yaml
      - uses: st0rm-bless3d/a11yscan@v0.1.2
        with:
          url: https://staging.example.com
          min-impact: serious
          fix-hints: "true"
        env:
          A11YSCAN_LLM_URL: ${{ secrets.A11YSCAN_LLM_URL }}
          A11YSCAN_LLM_KEY: ${{ secrets.A11YSCAN_LLM_KEY }}
          A11YSCAN_LLM_MODEL: gpt-4o-mini
```

The action installs Chromium via Playwright, runs the CLI with `--exit-code`
always set, and fails the job when `min-impact`'s threshold is met or a scan
error occurs.

## Security

**This tool runs with your own machine's network access — same trust model
as any local scanner (pa11y, axe-cli) run in your own CI.** Playwright
navigating to the URL you pass on the command line is this tool's normal,
intended job. There is no SSRF guard on that navigation — blocking it would
defeat the point of a local scanner (you're allowed to scan your own
internal staging server, localhost dev server, or anything else on your
network).

A separate SSRF guard (ported from the hosted a11yscan web-service's
`ssrf.ts` + `pinnedfetch.ts`) DOES apply to the CLI's own internal HTTP
calls — today, only the optional `--fix-hints` request to
`A11YSCAN_LLM_URL`. That guard resolves the configured hostname, rejects
private/link-local/loopback/reserved ranges (including the
`169.254.169.254` cloud metadata address), and pins the TCP connection to
the validated IP to close the DNS-rebind window between the check and the
request. One consequence worth knowing: if you run your LLM gateway on
`127.0.0.1` or `localhost`, `--fix-hints` will reject it by design and
silently fall back to axe's help text. Point `A11YSCAN_LLM_URL` at a LAN
hostname or IP (or `host.docker.internal` from inside a container) instead.

This is defense in depth, not a response to any live incident: today
`A11YSCAN_LLM_URL` is a value you set yourself. It stays anyway because a
mistyped or compromised config value should not be able to make this
process silently reach internal network services.

**The first-run browser install spawns a child process**, so it is scoped
narrowly. The interpreter is the running Node binary (`process.execPath`); the
script is the Playwright CLI resolved by absolute path out of a11yscan's own
`node_modules`, and is refused if it does not sit inside that package
directory; the arguments are the fixed literal list `["install", "chromium"]`;
and it runs with `shell: false`, so nothing is word-split or glob-expanded. No
value you pass on the command line — URL, flag, or environment variable —
reaches that argument list, so a scan target cannot influence what is executed.
It installs browsers only, never OS packages: `--with-deps` needs root and runs
your package manager, which is a much larger action than a scan should take on
its own. Use `--no-auto-install` to disable the child process entirely.

**No compliance claims.** This tool detects and reports; it does not
certify. You will not see the words "compliant," "certified," or
"guaranteed" anywhere in this codebase, its CLI output, or its LLM prompts
— only "detected N violations" / "no violations detected by this scan"
framing. (The FTC finalized a $1M order against accessiBe in 2025 for
"fully compliant" marketing language; this constraint is not optional.)
Generated fix-hint text is filtered by a banned-phrase guard as a second
layer in case the LLM ignores its system prompt.

## What this is not

This is a detection tool, not a certification. Automated scanners
(axe-core included) catch a meaningful subset of WCAG failures — reliably
things like missing alt text, contrast ratios, and missing form labels —
but cannot catch everything a manual audit with real assistive technology
would (task-flow usability, meaning of alt text, keyboard-trap edge cases
outside what axe checks, etc.). Treat a clean report as "no violations
detected by this scan," not as a guarantee of accessibility.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Tests use `node --test` + `tsx`, matching the reused scanner codebase's own
test runner. No test launches a real browser or makes a live network call —
axe-core results, exit-code logic, impact filtering, and the SSRF guard are
all exercised with fixtures/mocked resolvers.

## License

MIT © althor.dev — see [LICENSE](./LICENSE).
