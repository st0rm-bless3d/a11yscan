// The scan core: headless Chromium + axe-core against a URL you control.
//
// Deliberately NOT SSRF-guarded. A hosted service that fetches
// attacker-supplied URLs must stop a headless browser from reaching internal
// infrastructure. That threat model does not transfer here: this CLI runs on
// YOUR machine, scanning a URL YOU supply, with YOUR machine's network access.
// Scanning localhost, a private staging host, or an internal app is the whole
// point of a local scanner — the same trust model as pa11y or axe-cli in your
// own CI. See README "Security", and see ssrf.ts for the separate guard that
// DOES apply to the CLI's own outbound --fix-hints call.

import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser } from "playwright";
import { getConfig } from "./config.js";
import {
  BrowserSetupError,
  browserSetupGuidance,
  classifyLaunchFailure,
  installChromium,
  playwrightVersion,
  resolvePlaywrightCli,
} from "./browser-setup.js";
import { buildReport, errorScanReport, type AxeResults, type ScanReport } from "./report.js";

let browserPromise: Promise<Browser> | null = null;

function launchChromium(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
  });
}

/**
 * Launch Chromium, recovering from the one failure that every first-time user
 * hit: no Chromium build on disk for the Playwright this package resolved.
 *
 * At most ONE install and ONE retry per process. The result (including a
 * rejection) is cached by getBrowser(), so a multi-URL run never re-attempts a
 * ~150MB download per URL.
 */
async function launchWithSetup(autoInstall: boolean): Promise<Browser> {
  try {
    return await launchChromium();
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    const kind = classifyLaunchFailure(msg);

    if (kind !== "missing-browser") {
      throw new BrowserSetupError(browserSetupGuidance(kind, { autoInstall, upstream: msg }), kind);
    }
    if (!autoInstall) {
      throw new BrowserSetupError(browserSetupGuidance(kind, { autoInstall: false }), kind);
    }

    const cli = resolvePlaywrightCli();
    if (!cli) {
      const ctx = { autoInstall, installFailure: "could not locate the Playwright CLI in a11yscan's own node_modules" };
      throw new BrowserSetupError(browserSetupGuidance(kind, ctx), kind);
    }

    // Never silent: this downloads roughly 150MB. stderr, so `--json` stdout
    // stays parseable.
    const version = playwrightVersion();
    process.stderr.write(
      `a11yscan: Chromium for Playwright ${version ?? "(bundled)"} is not installed. ` +
        `Downloading it now — about 150MB, once, then cached for future runs.\n`,
    );

    const outcome = installChromium(cli);
    if (!outcome.ok) {
      throw new BrowserSetupError(browserSetupGuidance(kind, { autoInstall, installFailure: outcome.reason }), kind);
    }

    try {
      return await launchChromium();
    } catch (err2) {
      // The install succeeded, so a failure here is a DIFFERENT problem —
      // most often missing OS shared libraries. Classify it again rather than
      // reporting it as another missing browser.
      const msg2 = (err2 as Error).message ?? String(err2);
      const kind2 = classifyLaunchFailure(msg2);
      throw new BrowserSetupError(
        browserSetupGuidance(kind2, { autoInstall, afterInstall: true, upstream: msg2 }),
        kind2,
      );
    }
  }
}

async function getBrowser(autoInstall: boolean): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchWithSetup(autoInstall);
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close().catch(() => {});
  }
}

export interface ScanOptions {
  timeoutMs?: number;
  /**
   * Download the matching Chromium build if it is missing.
   *
   * Defaults to FALSE for programmatic callers, and the CLI passes `true`
   * explicitly. The install is a synchronous `spawnSync`, so it blocks the
   * event loop for the length of a ~150MB download; a server that embedded
   * `scanUrl` would stop answering requests for up to ten minutes. That is an
   * acceptable trade for a one-shot CLI process and not for a library, so the
   * two defaults differ on purpose.
   */
  autoInstall?: boolean;
}

/**
 * Scan one URL. Never throws for expected failure modes (bad URL, navigation
 * failure, timeout) — those come back as a ScanReport with `error` set so a
 * multi-URL run can keep going. Only a genuine bug (Playwright itself failing
 * to launch, etc.) propagates.
 */
export async function scanUrl(rawUrl: string, opts: ScanOptions = {}): Promise<ScanReport> {
  const start = Date.now();
  const config = getConfig();
  const timeoutMs = opts.timeoutMs ?? config.scan.timeoutMs;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return errorScanReport(rawUrl, "", 0, `Could not parse "${rawUrl}" as a URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return errorScanReport(rawUrl, url.hostname, 0, "Only http and https URLs are supported.");
  }

  const notes: string[] = [];
  let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  try {
    const browser = await getBrowser(opts.autoInstall ?? false);
    context = await browser.newContext({
      acceptDownloads: false,
      userAgent: config.scan.userAgent,
      viewport: { width: 1280, height: 900 },
    });
    context.setDefaultNavigationTimeout(timeoutMs);
    context.setDefaultTimeout(timeoutMs);

    const page = await context.newPage();
    const response = await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    if (!response) {
      return errorScanReport(url.toString(), url.hostname, Date.now() - start, "The page did not respond.");
    }
    if (response.status() >= 400) {
      notes.push(`Page returned HTTP ${response.status()}.`);
    }

    // Give late-loading content a brief settle window, bounded by the overall
    // navigation timeout above.
    await page.waitForTimeout(500);

    const axe = (await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze()) as unknown as AxeResults;

    return buildReport(url.toString(), url.hostname, Date.now() - start, axe, notes);
  } catch (err) {
    // A browser-setup failure already carries a purpose-written message with
    // the exact command to run. Pass it through untouched: wrapping it in
    // "Could not load the page for scanning (...)" and slicing to 200 chars is
    // what used to cut Playwright's own instructions in half and leave the
    // user staring at half a box-drawing border.
    if (err instanceof BrowserSetupError) {
      return errorScanReport(url.toString(), url.hostname, Date.now() - start, err.message);
    }
    const msg = (err as Error).message ?? String(err);
    // Not truncated here. The report carries the full text; format.ts decides
    // how much of it to render, and preserves any actionable line when it trims.
    const friendly = /timeout/i.test(msg)
      ? "The scan timed out."
      : `Could not load the page for scanning: ${msg}`;
    return errorScanReport(url.toString(), url.hostname, Date.now() - start, friendly);
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
