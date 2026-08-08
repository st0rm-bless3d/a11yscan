import { type ScanReport } from "./report.js";
export declare function closeBrowser(): Promise<void>;
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
export declare function scanUrl(rawUrl: string, opts?: ScanOptions): Promise<ScanReport>;
