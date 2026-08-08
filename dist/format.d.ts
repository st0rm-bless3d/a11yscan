import { type Impact, type ScanReport } from "./report.js";
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
