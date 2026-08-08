import { type ScanReport } from "./report.js";
export declare function closeBrowser(): Promise<void>;
export interface ScanOptions {
    timeoutMs?: number;
}
/**
 * Scan one URL. Never throws for expected failure modes (bad URL, navigation
 * failure, timeout) — those come back as a ScanReport with `error` set so a
 * multi-URL run can keep going. Only a genuine bug (Playwright itself failing
 * to launch, etc.) propagates.
 */
export declare function scanUrl(rawUrl: string, opts?: ScanOptions): Promise<ScanReport>;
