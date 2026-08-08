// Pinned outbound fetch for the CLI's own internal calls (the --fix-hints LLM
// request). In a hosted service this pattern stops a headless browser from
// ever opening a socket to an attacker-influenced address; here it closes
// the DNS-rebind TOCTOU window between ssrf.ts's validateUrl() and the actual
// HTTP request for a config-supplied LLM endpoint. Node performs the
// connection itself, pinned to the IP already validated, instead of trusting a
// second independent DNS resolution.
//
// Byte cap is enforced while streaming (not after), so an oversized or
// header-less/chunked response cannot exhaust memory before rejection.
import { Agent, request } from "undici";
export class PinnedFetchError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "PinnedFetchError";
        this.code = code;
    }
}
const STRIP_RESPONSE_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
]);
const STRIP_REQUEST_HEADERS = new Set(["host", "connection", "content-length", "proxy-connection"]);
/**
 * Fetch `targetUrl` but force the TCP connection to `pinnedIp`. Redirects are
 * NOT followed here (maxRedirections: 0): a 3xx is returned as-is.
 */
export async function pinnedFetch(targetUrl, opts) {
    const agent = new Agent({
        connections: 1,
        pipelining: 0,
        headersTimeout: opts.timeoutMs,
        bodyTimeout: opts.timeoutMs,
        connect: {
            lookup: (_hostname, options, cb) => {
                if (options && options.all) {
                    cb(null, [{ address: opts.pinnedIp, family: opts.family }]);
                }
                else {
                    cb(null, opts.pinnedIp, opts.family);
                }
            },
        },
    });
    const reqHeaders = {};
    for (const [k, v] of Object.entries(opts.headers)) {
        if (!STRIP_REQUEST_HEADERS.has(k.toLowerCase()))
            reqHeaders[k] = v;
    }
    try {
        const res = await request(targetUrl, {
            method: opts.method,
            headers: reqHeaders,
            body: opts.body ?? undefined,
            maxRedirections: 0,
            dispatcher: agent,
        });
        const chunks = [];
        let total = 0;
        for await (const chunk of res.body) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buf.length;
            if (total > opts.maxBytes) {
                res.body.destroy();
                throw new PinnedFetchError("too-large", "Response exceeded the size cap.");
            }
            chunks.push(buf);
        }
        const headers = {};
        for (const [k, v] of Object.entries(res.headers)) {
            const key = k.toLowerCase();
            if (STRIP_RESPONSE_HEADERS.has(key))
                continue;
            if (v === undefined)
                continue;
            headers[key] = Array.isArray(v) ? v.join(", ") : String(v);
        }
        return { status: res.statusCode, headers, body: Buffer.concat(chunks) };
    }
    catch (err) {
        if (err instanceof PinnedFetchError)
            throw err;
        throw new PinnedFetchError("fetch-failed", err.message ?? "Fetch failed.");
    }
    finally {
        await agent.close().catch(() => { });
    }
}
//# sourceMappingURL=pinnedfetch.js.map