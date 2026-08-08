// Env-driven config for the optional --fix-hints LLM call. Nothing else in
// the CLI reads the environment. No secrets are hardcoded.
function envInt(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === "")
        return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
}
function envStr(name, fallback) {
    const raw = process.env[name];
    return raw === undefined || raw === "" ? fallback : raw;
}
// A function, not a frozen module-level const: process.env can legitimately
// change within a process lifetime (tests exercising multiple env scenarios
// in one file, or an embedder setting env vars just before calling into this
// library). Reading fresh on every call costs nothing measurable and avoids
// a whole class of "stale config from first import" bugs.
export function getConfig() {
    return {
        llm: {
            // Any OpenAI-compatible /v1/chat/completions endpoint. Unset by
            // default — --fix-hints degrades to axe's own help text with no
            // network call at all when this is empty.
            baseUrl: envStr("A11YSCAN_LLM_URL", ""),
            apiKey: envStr("A11YSCAN_LLM_KEY", ""),
            model: envStr("A11YSCAN_LLM_MODEL", "gpt-4o-mini"),
            timeoutMs: envInt("A11YSCAN_LLM_TIMEOUT_MS", 8000),
            concurrency: envInt("A11YSCAN_LLM_CONCURRENCY", 3),
            // Skip the LLM entirely once a scan has more distinct violated rules
            // than this (keeps a pathological page from fanning out unbounded
            // requests).
            maxRules: envInt("A11YSCAN_LLM_MAX_RULES", 40),
            maxResponseBytes: envInt("A11YSCAN_LLM_MAX_RESPONSE_BYTES", 1_000_000),
        },
        scan: {
            timeoutMs: envInt("A11YSCAN_SCAN_TIMEOUT_MS", 30_000),
            userAgent: envStr("A11YSCAN_USER_AGENT", "a11yscan-cli/0.1 (+https://a11yscan.althor.dev)"),
        },
    };
}
//# sourceMappingURL=config.js.map