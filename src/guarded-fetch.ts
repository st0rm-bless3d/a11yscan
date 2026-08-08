// Combines ssrf.ts + pinnedfetch.ts into the one call site the CLI needs:
// "make an HTTP request to a config-supplied URL without landing on internal
// network infrastructure." Used exclusively by fixhints.ts for the optional
// --fix-hints LLM call. Never used for the user's scan target — see
// ssrf.ts's file header for why that split exists.
//
// Returns null (never throws) on any rejection or failure so callers can
// degrade gracefully without a try/catch at every call site.

import { pinnedFetch, PinnedFetchError } from "./pinnedfetch.js";
import { SsrfError, validateUrl, type Resolver } from "./ssrf.js";

export interface GuardedFetchOptions {
  method: string;
  headers: Record<string, string>;
  body?: string | null;
  timeoutMs: number;
  maxBytes: number;
  resolver?: Resolver; // injectable for tests
}

export interface GuardedFetchResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export async function guardedFetch(
  targetUrl: string,
  opts: GuardedFetchOptions,
): Promise<GuardedFetchResult | null> {
  let validated;
  try {
    validated = await validateUrl(targetUrl, opts.resolver);
  } catch (err) {
    if (err instanceof SsrfError) return null;
    throw err;
  }

  try {
    return await pinnedFetch(targetUrl, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body ?? null,
      pinnedIp: validated.pinnedIp,
      family: (validated.pinnedIp.includes(":") ? 6 : 4) as 4 | 6,
      maxBytes: opts.maxBytes,
      timeoutMs: opts.timeoutMs,
    });
  } catch (err) {
    if (err instanceof PinnedFetchError) return null;
    throw err;
  }
}
