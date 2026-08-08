#!/usr/bin/env node
import { type Impact } from "./report.js";
interface ParsedArgs {
    urls: string[];
    json: boolean;
    minImpact: Impact;
    exitCode: boolean;
    fixHints: boolean;
    help: boolean;
}
export declare function parseArgs(argv: string[]): ParsedArgs;
export declare class UsageError extends Error {
}
export {};
