import { type Impact, type ScanReport } from "./report.js";
export interface SanitizeOptions {
    /** Maximum lines to render. Actionable lines are kept even past this. */
    maxLines?: number;
    /** Per-line character cap. Actionable lines are never shortened. */
    maxLineLength?: number;
}
/**
 * Turn an arbitrary upstream error string into readable plain lines.
 * Pure and dependency-free, so it is unit-testable against real Playwright
 * output. Returns lines joined by "\n"; callers own the indenting.
 */
export declare function sanitizeErrorText(raw: string, opts?: SanitizeOptions): string;
export declare function formatHuman(reports: ScanReport[], minImpact: Impact): string;
export interface JsonViolation {
    id: string;
    impact: Impact;
    tags: string[];
    help: string;
    helpUrl: string;
    description: string;
    nodeCount: number;
    nodes: {
        selector: string;
        failureSummary: string;
    }[];
    fix: {
        text: string;
        source: "llm" | "axe";
    };
}
export interface JsonReport {
    url: string;
    hostname: string;
    scannedAt: string;
    durationMs: number;
    error?: string;
    summary: ScanReport["summary"];
    violations: JsonViolation[];
    incompleteRules: ScanReport["incompleteRules"];
    notes: string[];
}
export declare function toJson(reports: ScanReport[], minImpact: Impact): JsonReport[];
export declare function formatJson(reports: ScanReport[], minImpact: Impact): string;
