import type { Fix } from "./report.js";
import type { Resolver } from "./ssrf.js";
export declare function tripsCopyGuard(text: string): boolean;
export interface RuleForGuidance {
    id: string;
    description: string;
    help: string;
    impact: string | null;
}
/**
 * Given the distinct violated rules in a scan, return a map ruleId -> Fix.
 * Every rule always gets an entry (axe's own help text as the floor); rules
 * the LLM successfully answers (and that pass the copy guard) get upgraded to
 * source "llm". Disabled entirely (zero network calls) when A11YSCAN_LLM_URL
 * is unset.
 */
export declare function fixGuidanceFor(rules: RuleForGuidance[], resolver?: Resolver): Promise<Map<string, Fix>>;
