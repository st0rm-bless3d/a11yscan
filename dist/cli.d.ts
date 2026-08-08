#!/usr/bin/env node
import { type Impact } from "./report.js";
interface ParsedArgs {
    urls: string[];
    json: boolean;
    minImpact: Impact;
    exitCode: boolean;
    fixHints: boolean;
    autoInstall: boolean;
    help: boolean;
}
/** Env default for auto-install, so CI can switch it off without editing the
 * command line. `0`, `false`, `no` and `off` disable it; anything else (and
 * unset) leaves it on. */
export declare function autoInstallDefault(env?: NodeJS.ProcessEnv): boolean;
export declare function parseArgs(argv: string[], env?: NodeJS.ProcessEnv): ParsedArgs;
export declare class UsageError extends Error {
}
export {};
