export interface PinnedResponse {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
}
export declare class PinnedFetchError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export interface PinnedFetchOptions {
    method: string;
    headers: Record<string, string>;
    body?: Buffer | string | null;
    pinnedIp: string;
    family: 4 | 6;
    maxBytes: number;
    timeoutMs: number;
}
/**
 * Fetch `targetUrl` but force the TCP connection to `pinnedIp`. Redirects are
 * NOT followed here (maxRedirections: 0): a 3xx is returned as-is.
 */
export declare function pinnedFetch(targetUrl: string, opts: PinnedFetchOptions): Promise<PinnedResponse>;
