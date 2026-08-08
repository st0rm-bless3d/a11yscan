// Optional plain-English "how to fix" guidance per violation RULE, generated
// via an OpenAI-compatible chat endpoint (A11YSCAN_LLM_URL / _KEY / _MODEL).
// Ported from the hosted a11yscan web-service's llm.ts. MUST degrade
// gracefully to axe-core's own help text when the endpoint is unset,
// unreachable, slow, blocked by the SSRF guard, or returns something that
// trips the copy guard below — never throws, never blocks the rest of the
// report.
//
// HARD COPY CONSTRAINT: never state or imply a site is / will be "compliant"
// or "guaranteed compliant" (the FTC finalized a $1M order against accessiBe
// for that overclaim). Enforced two ways: the system prompt forbids it, and
// generated text is rejected by a banned-phrase guard as defense in depth.

import { getConfig } from "./config.js";
import type { Fix } from "./report.js";
import { guardedFetch } from "./guarded-fetch.js";
import type { Resolver } from "./ssrf.js";

const BANNED = [
  /\bcompliant\b/i,
  /\bcompliance\b/i,
  /\bguarantee/i,
  /\blawsuit-proof\b/i,
  /\bada[- ]?compliant\b/i,
  /\bwcag[- ]?compliant\b/i,
  /\bfully accessible\b/i,
  /\blegally\b/i,
];

export function tripsCopyGuard(text: string): boolean {
  return BANNED.some((re) => re.test(text));
}

const SYSTEM_PROMPT =
  "You are an accessibility engineer helping a developer fix a specific WCAG issue " +
  "flagged by the axe-core rule engine. Given the rule id, its description, and its " +
  "impact, write ONE or TWO short, plain, declarative sentences telling the developer " +
  "concretely how to fix it in their HTML/CSS/ARIA. Be specific and practical. " +
  "Do not use hype or marketing language. Never claim, state, or imply that fixing " +
  "this makes a site 'compliant', 'ADA compliant', 'WCAG compliant', 'guaranteed', " +
  "'fully accessible', or legally safe. Frame everything as detection and remediation " +
  "guidance only. Output only the fix guidance, no preamble.";

export interface RuleForGuidance {
  id: string;
  description: string;
  help: string;
  impact: string | null;
}

async function callLlm(rule: RuleForGuidance, resolver?: Resolver): Promise<string | null> {
  const config = getConfig();
  const res = await guardedFetch(`${config.llm.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify({
      model: config.llm.model,
      temperature: 0.2,
      max_tokens: 120,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Rule id: ${rule.id}\n` +
            `Impact: ${rule.impact ?? "unknown"}\n` +
            `Description: ${rule.description}\n` +
            `axe help text: ${rule.help}`,
        },
      ],
    }),
    timeoutMs: config.llm.timeoutMs,
    maxBytes: config.llm.maxResponseBytes,
    resolver,
  });
  if (!res || res.status < 200 || res.status >= 300) return null;
  try {
    const data = JSON.parse(res.body.toString("utf8")) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    if (tripsCopyGuard(text)) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * Given the distinct violated rules in a scan, return a map ruleId -> Fix.
 * Every rule always gets an entry (axe's own help text as the floor); rules
 * the LLM successfully answers (and that pass the copy guard) get upgraded to
 * source "llm". Disabled entirely (zero network calls) when A11YSCAN_LLM_URL
 * is unset.
 */
export async function fixGuidanceFor(rules: RuleForGuidance[], resolver?: Resolver): Promise<Map<string, Fix>> {
  const config = getConfig();
  const out = new Map<string, Fix>();
  for (const r of rules) out.set(r.id, { text: r.help, source: "axe" });

  if (!config.llm.baseUrl) return out; // --fix-hints with no endpoint configured
  if (rules.length > config.llm.maxRules) return out; // too many; skip LLM entirely

  const cache = new Map<string, string>();
  const queue = [...rules];
  const runWorker = async (): Promise<void> => {
    for (;;) {
      const rule = queue.shift();
      if (!rule) return;
      const cached = cache.get(rule.id);
      if (cached !== undefined) {
        out.set(rule.id, { text: cached, source: "llm" });
        continue;
      }
      const text = await callLlm(rule, resolver);
      if (text) {
        cache.set(rule.id, text);
        out.set(rule.id, { text, source: "llm" });
      }
      // On failure/null, the axe fallback already set above stands.
    }
  };
  const n = Math.max(1, Math.min(config.llm.concurrency, rules.length));
  await Promise.all(Array.from({ length: n }, () => runWorker()));
  return out;
}
