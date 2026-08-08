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
import { chromium } from "playwright";
import { getConfig } from "./config.js";
import { buildReport, errorScanReport } from "./report.js";
let browserPromise = null;
async function getBrowser() {
    if (!browserPromise) {
        browserPromise = chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
        });
    }
    return browserPromise;
}
export async function closeBrowser() {
    if (browserPromise) {
        const b = await browserPromise.catch(() => null);
        browserPromise = null;
        if (b)
            await b.close().catch(() => { });
    }
}
/**
 * Scan one URL. Never throws for expected failure modes (bad URL, navigation
 * failure, timeout) — those come back as a ScanReport with `error` set so a
 * multi-URL run can keep going. Only a genuine bug (Playwright itself failing
 * to launch, etc.) propagates.
 */
export async function scanUrl(rawUrl, opts = {}) {
    const start = Date.now();
    const config = getConfig();
    const timeoutMs = opts.timeoutMs ?? config.scan.timeoutMs;
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        return errorScanReport(rawUrl, "", 0, `Could not parse "${rawUrl}" as a URL.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return errorScanReport(rawUrl, url.hostname, 0, "Only http and https URLs are supported.");
    }
    const notes = [];
    let context = null;
    try {
        const browser = await getBrowser();
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
            .analyze());
        return buildReport(url.toString(), url.hostname, Date.now() - start, axe, notes);
    }
    catch (err) {
        const msg = err.message ?? String(err);
        const friendly = /timeout/i.test(msg)
            ? "The scan timed out."
            : `Could not load the page for scanning (${msg.slice(0, 200)}).`;
        return errorScanReport(url.toString(), url.hostname, Date.now() - start, friendly);
    }
    finally {
        if (context)
            await context.close().catch(() => { });
    }
}
//# sourceMappingURL=scan.js.map