export interface ResolvedHost {
    ip: string;
    family: 4 | 6;
}
export type Resolver = (hostname: string) => Promise<ResolvedHost[]>;
export declare class SsrfError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/**
 * Classify a single IP string. Returns null if the IP is a public unicast
 * address; otherwise returns the reason it is blocked.
 */
export declare function classifyIp(ipStr: string): string | null;
export interface ValidationResult {
    url: URL;
    hostname: string;
    resolvedIps: string[];
    pinnedIp: string;
}
/**
 * Validate a URL for SSRF safety before the CLI makes a request to it.
 * Throws SsrfError on rejection.
 */
export declare function validateUrl(rawUrl: string, resolver?: Resolver): Promise<ValidationResult>;
