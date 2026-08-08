// Output formatting. Every string here is checked against the FTC copy
// constraint at the source (fixhints.ts's banned-phrase guard covers LLM
// text; the literal strings below are hand-written and must never say
// "compliant", "certified", "guaranteed", or "passes WCAG" — only "detected N
// violations" / "no violations detected by this scan" framing.
import { filterByMinImpact, IMPACT_ORDER } from "./report.js";
const IMPACT_LABEL = {
    critical: "CRITICAL",
    serious: "SERIOUS",
    moderate: "MODERATE",
    minor: "MINOR",
};
// --- Error text sanitising -------------------------------------------------
//
// Upstream errors are not single-line. Playwright wraps its most useful
// message — the command you need to run — inside a Unicode box:
//
//   browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/...
//   ╔════════════════════════════════════════════════════════════════════╗
//   ║ Please run the following command to download new browsers:         ║
//   ║     npx playwright install                                         ║
//   ╚════════════════════════════════════════════════════════════════════╝
//
// Rendering that through a bare `ERROR: ${r.error}` after a fixed-length
// slice produced output that ended mid-border, threw away the one actionable
// sentence, and read as corruption. So: strip the decoration, keep the words,
// and if the text must be trimmed, never drop a line that tells the user what
// to run.
// Box drawing (U+2500–U+257F) and block elements (U+2580–U+259F).
const BOX_DRAWING = new RegExp("[\\u2500-\\u259F]", "g");
// SGR / CSI escape sequences, in case a child process emitted colour.
// Built from escapes rather than a literal ESC so the source stays plain text.
const ANSI = new RegExp("\\u001B\\[[0-9;?]*[ -/]*[@-~]", "g");
// A line worth protecting from truncation: it names something to run.
// `playwright\S*` deliberately tolerates the forms a11yscan itself emits and
// the ones Playwright emits: `playwright install`, `playwright@1.62.1 install`,
// and the absolute `node /.../node_modules/playwright/cli.js install` that
// browser-setup.ts produces so the command works from any directory.
const ACTIONABLE = /(playwright\S*\s+install|install-deps|apt-get\s+install|npm\s+(?:i|install)\b|npx\s+)/i;
const MAX_HUMAN_LINES = 14;
const MAX_LINE_LENGTH = 300;
// Actionable lines are exempt from maxLineLength so a command is never cut,
// but "exempt" cannot mean "unbounded": a 4KB log line that merely happens to
// contain the substring "npx " would otherwise be dumped verbatim into the
// terminal, which is the unreadable-output problem this module exists to fix.
// No command a11yscan or Playwright emits comes near this.
const ACTIONABLE_LINE_CEILING = 1000;
/**
 * Turn an arbitrary upstream error string into readable plain lines.
 * Pure and dependency-free, so it is unit-testable against real Playwright
 * output. Returns lines joined by "\n"; callers own the indenting.
 */
export function sanitizeErrorText(raw, opts = {}) {
    const maxLines = opts.maxLines ?? Number.POSITIVE_INFINITY;
    const maxLineLength = opts.maxLineLength ?? Number.POSITIVE_INFINITY;
    const cleaned = String(raw ?? "")
        .replace(ANSI, "")
        .split(/\r?\n/)
        .map((line) => line.replace(BOX_DRAWING, "").trim())
        // Playwright's boxes use a trailing "\" as a line continuation in the
        // apt-get list; it is noise once the border is gone.
        .map((line) => line.replace(/\\$/, "").trim())
        .filter((line) => line.length > 0)
        .map((line) => {
        // Actionable lines get a far more generous cap, not an infinite one.
        const cap = ACTIONABLE.test(line) ? Math.max(maxLineLength, ACTIONABLE_LINE_CEILING) : maxLineLength;
        return line.length <= cap ? line : line.slice(0, cap) + "…";
    });
    // Collapse runs of identical lines (box padding often repeats).
    const lines = [];
    for (const line of cleaned) {
        if (lines[lines.length - 1] !== line)
            lines.push(line);
    }
    if (lines.length === 0)
        return "Unknown error.";
    if (lines.length <= maxLines)
        return lines.join("\n");
    // Over budget. Keep every actionable line, then fill the remaining budget
    // from the top so the failure itself is still stated. This can exceed
    // maxLines when a message is mostly commands, which is deliberate: losing
    // the instructions is the bug being fixed here, a slightly long message is
    // not. It is still bounded, at twice the requested budget, so a pathological
    // input cannot turn into an unbounded dump.
    const ceiling = Number.isFinite(maxLines) ? maxLines * 2 : maxLines;
    const keep = new Set();
    for (let i = 0; i < lines.length && keep.size < ceiling; i++) {
        if (ACTIONABLE.test(lines[i]))
            keep.add(i);
    }
    const headBudget = Math.max(1, maxLines - keep.size - 1);
    for (let i = 0; i < lines.length && i < headBudget; i++)
        keep.add(i);
    const out = [];
    let prev = -1;
    for (const i of [...keep].sort((a, b) => a - b)) {
        if (prev !== -1 && i !== prev + 1)
            out.push("...");
        out.push(lines[i]);
        prev = i;
    }
    return out.join("\n");
}
/** Render an error under a `  ERROR: ` label, continuation lines aligned. */
function formatError(raw) {
    const lines = sanitizeErrorText(raw, { maxLines: MAX_HUMAN_LINES, maxLineLength: MAX_LINE_LENGTH }).split("\n");
    const [first, ...rest] = lines;
    return [`  ERROR: ${first}`, ...rest.map((l) => `         ${l}`)];
}
function formatViolation(v) {
    const lines = [];
    lines.push(`  [${IMPACT_LABEL[v.impact]}] ${v.id} — ${v.description}`);
    if (v.wcagTags.length > 0)
        lines.push(`    WCAG: ${v.wcagTags.join(", ")}`);
    lines.push(`    Affected elements (${v.nodeCount}):`);
    for (const n of v.nodes) {
        lines.push(`      - ${n.target}`);
    }
    if (v.nodeCount > v.nodes.length) {
        lines.push(`      ... and ${v.nodeCount - v.nodes.length} more`);
    }
    lines.push(`    Fix: ${v.fix.text}`);
    if (v.helpUrl)
        lines.push(`    More info: ${v.helpUrl}`);
    return lines.join("\n");
}
export function formatHuman(reports, minImpact) {
    const out = [];
    for (const r of reports) {
        out.push(`\n${r.url}`);
        if (r.error) {
            out.push(...formatError(r.error));
            continue;
        }
        const shown = filterByMinImpact(r.violations, minImpact);
        out.push(`  Detected ${r.summary.violationRules} violation rule(s): ` +
            `${r.summary.critical} critical, ${r.summary.serious} serious, ` +
            `${r.summary.moderate} moderate, ${r.summary.minor} minor. ` +
            `(${r.summary.passes} checks passed, ${r.summary.incomplete} incomplete.)`);
        if (minImpact !== "minor") {
            out.push(`  Showing ${shown.length} at or above "${minImpact}".`);
        }
        if (shown.length === 0) {
            out.push("  No violations detected by this scan at the selected threshold.");
        }
        for (const impact of IMPACT_ORDER) {
            const group = shown.filter((v) => v.impact === impact);
            if (group.length === 0)
                continue;
            out.push(`\n  -- ${IMPACT_LABEL[impact]} --`);
            for (const v of group)
                out.push(formatViolation(v));
        }
        for (const note of r.notes)
            out.push(`  Note: ${note}`);
    }
    out.push("\nThis report reflects only what this scan detected. It is not a compliance " +
        "certification and does not guarantee WCAG conformance.");
    return out.join("\n");
}
export function toJson(reports, minImpact) {
    return reports.map((r) => ({
        url: r.url,
        hostname: r.hostname,
        scannedAt: r.scannedAt,
        durationMs: r.durationMs,
        // Decoration stripped, but NOT truncated: a machine consumer should get
        // the whole message, including the command it names.
        ...(r.error ? { error: sanitizeErrorText(r.error) } : {}),
        summary: r.summary,
        violations: filterByMinImpact(r.violations, minImpact).map((v) => ({
            id: v.id,
            impact: v.impact,
            tags: v.wcagTags,
            help: v.help,
            helpUrl: v.helpUrl,
            description: v.description,
            nodeCount: v.nodeCount,
            nodes: v.nodes.map((n) => ({ selector: n.target, failureSummary: n.failureSummary })),
            fix: v.fix,
        })),
        incompleteRules: r.incompleteRules,
        notes: r.notes,
    }));
}
export function formatJson(reports, minImpact) {
    return JSON.stringify(toJson(reports, minImpact), null, 2);
}
//# sourceMappingURL=format.js.map