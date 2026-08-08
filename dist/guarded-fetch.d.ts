import { type Resolver } from "./ssrf.js";
export interface GuardedFetchOptions {
    method: string;
    headers: Record<string, string>;
    body?: string | null;
    timeoutMs: number;
    maxBytes: number;
    resolver?: Resolver;
}
export interface GuardedFetchResult {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
}
export declare function guardedFetch(targetUrl: string, opts: GuardedFetchOptions): Promise<GuardedFetchResult | null>;
