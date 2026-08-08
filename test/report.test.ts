import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReport,
  decideExitCode,
  errorScanReport,
  filterByMinImpact,
  meetsThreshold,
  normalizeImpact,
  safeHttpUrl,
  type AxeResults,
  type ScanReport,
} from "../src/report.js";

function fixtureAxe(): AxeResults {
  return {
    violations: [
      {
        id: "color-contrast",
        impact: "serious",
        description: "Elements must meet minimum color contrast ratio",
        help: "Elements must have sufficient color contrast",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
        tags: ["wcag2aa", "wcag143", "best-practice"],
        nodes: [
          { target: ["button.cta"], failureSummary: "Fix contrast on button.cta" },
          { target: ["a.footer-link"], failureSummary: "Fix contrast on a.footer-link" },
        ],
      },
      {
        id: "image-alt",
        impact: "critical",
        description: "Images must have alternate text",
        help: "Images must have alternate text",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.10/image-alt",
        tags: ["wcag2a", "wcag111"],
        nodes: [{ target: ["img.hero"], failureSummary: "Add alt text" }],
      },
      {
        id: "region",
        impact: "moderate",
        description: "All page content should be contained by landmarks",
        help: "All page content should be contained by landmarks",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.10/region",
        tags: ["best-practice"],
        nodes: [{ target: ["div.stray"] }],
      },
      {
        id: "unknown-impact-rule",
        impact: undefined,
        description: "Rule with no impact reported by axe",
        help: "Investigate manually",
        helpUrl: "not a url",
        tags: [],
        nodes: [{ target: ["span.weird"] }],
      },
    ],
    passes: [{ id: "html-has-lang" }, { id: "document-title" }],
    incomplete: [
      {
        id: "color-contrast-incomplete",
        impact: "serious",
        description: "Needs manual review",
        help: "Check manually",
        helpUrl: "https://dequeuniversity.com/rules/axe/4.10/color-contrast",
        tags: [],
        nodes: [],
      },
    ],
  };
}

test("buildReport groups counts by impact and sorts critical-first", () => {
  const r = buildReport("https://example.com/", "example.com", 1234, fixtureAxe(), ["a note"]);

  assert.equal(r.url, "https://example.com/");
  assert.equal(r.hostname, "example.com");
  assert.equal(r.durationMs, 1234);
  assert.deepEqual(r.notes, ["a note"]);

  // 4 distinct violated rules: critical, serious, moderate, and one with no
  // impact reported (normalized to "minor").
  assert.equal(r.summary.violationRules, 4);
  assert.equal(r.summary.critical, 1);
  assert.equal(r.summary.serious, 1);
  assert.equal(r.summary.moderate, 1);
  assert.equal(r.summary.minor, 1);
  assert.equal(r.summary.passes, 2);
  assert.equal(r.summary.incomplete, 1);

  // Sorted critical -> serious -> moderate -> minor.
  assert.deepEqual(
    r.violations.map((v) => v.impact),
    ["critical", "serious", "moderate", "minor"],
  );

  const contrast = r.violations.find((v) => v.id === "color-contrast")!;
  assert.equal(contrast.nodeCount, 2);
  assert.deepEqual(
    contrast.wcagTags,
    ["wcag2aa", "wcag143"], // best-practice filtered out (not a wcag* tag)
  );
  assert.equal(contrast.nodes[0]?.target, "button.cta");
  assert.equal(contrast.fix.source, "axe");
  assert.equal(contrast.fix.text, contrast.help);

  const weird = r.violations.find((v) => v.id === "unknown-impact-rule")!;
  assert.equal(weird.impact, "minor");
  assert.equal(weird.helpUrl, ""); // "not a url" is rejected by safeHttpUrl

  assert.equal(r.incompleteRules.length, 1);
  assert.equal(r.incompleteRules[0]?.id, "color-contrast-incomplete");
});

test("buildReport caps the node sample at 5 but keeps the true nodeCount", () => {
  const axe = fixtureAxe();
  axe.violations[0]!.nodes = Array.from({ length: 12 }, (_, i) => ({ target: [`el-${i}`] }));
  const r = buildReport("https://example.com/", "example.com", 0, axe);
  const contrast = r.violations.find((v) => v.id === "color-contrast")!;
  assert.equal(contrast.nodeCount, 12);
  assert.equal(contrast.nodes.length, 5);
});

test("normalizeImpact falls back to minor for anything unrecognized", () => {
  assert.equal(normalizeImpact("critical"), "critical");
  assert.equal(normalizeImpact("made-up"), "minor");
  assert.equal(normalizeImpact(null), "minor");
  assert.equal(normalizeImpact(undefined), "minor");
});

test("safeHttpUrl only allows http(s), rejects garbage and other schemes", () => {
  assert.equal(safeHttpUrl("https://example.com/x"), "https://example.com/x");
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("not a url"), "");
  assert.equal(safeHttpUrl("file:///etc/passwd"), "");
});

test("meetsThreshold: at-or-above severity semantics", () => {
  assert.equal(meetsThreshold("critical", "serious"), true);
  assert.equal(meetsThreshold("serious", "serious"), true);
  assert.equal(meetsThreshold("moderate", "serious"), false);
  assert.equal(meetsThreshold("minor", "minor"), true);
  assert.equal(meetsThreshold("critical", "minor"), true);
});

test("--min-impact filtering: each threshold includes exactly the expected impacts", () => {
  const r = buildReport("https://example.com/", "example.com", 0, fixtureAxe());

  assert.deepEqual(
    filterByMinImpact(r.violations, "minor").map((v) => v.impact).sort(),
    ["critical", "minor", "moderate", "serious"].sort(),
  );
  assert.deepEqual(
    filterByMinImpact(r.violations, "moderate").map((v) => v.impact).sort(),
    ["critical", "moderate", "serious"].sort(),
  );
  assert.deepEqual(
    filterByMinImpact(r.violations, "serious").map((v) => v.impact).sort(),
    ["critical", "serious"].sort(),
  );
  assert.deepEqual(
    filterByMinImpact(r.violations, "critical").map((v) => v.impact),
    ["critical"],
  );
});

test("decideExitCode: no --exit-code means 0 no matter what was found", () => {
  const r = buildReport("https://example.com/", "example.com", 0, fixtureAxe());
  assert.equal(decideExitCode([r], "minor", false), 0);
  assert.equal(decideExitCode([r], "critical", false), 0);
});

test("decideExitCode: --exit-code trips only when something meets the threshold", () => {
  const r = buildReport("https://example.com/", "example.com", 0, fixtureAxe());
  // fixtureAxe has one violation of each impact, so every threshold matches something.
  assert.equal(decideExitCode([r], "minor", true), 1);
  assert.equal(decideExitCode([r], "critical", true), 1);

  const clean = buildReport("https://clean.example.com/", "clean.example.com", 0, {
    violations: [],
    passes: [{ id: "x" }],
    incomplete: [],
  });
  assert.equal(decideExitCode([clean], "minor", true), 0);
  assert.equal(decideExitCode([clean], "critical", true), 0);
});

test("decideExitCode: a scan error is always 2, regardless of --exit-code", () => {
  const errored = errorScanReport("https://down.example.com/", "down.example.com", 0, "The scan timed out.");
  const clean = buildReport("https://clean.example.com/", "clean.example.com", 0, {
    violations: [],
    passes: [],
    incomplete: [],
  });
  assert.equal(decideExitCode([errored], "minor", false), 2);
  assert.equal(decideExitCode([errored], "minor", true), 2);
  // Mixed batch: one errored URL still forces 2 even if the other is clean.
  assert.equal(decideExitCode([clean, errored], "minor", false), 2);
});

test("decideExitCode across a multi-URL batch: only reacts to reports that qualify", () => {
  const hot = buildReport("https://hot.example.com/", "hot.example.com", 0, fixtureAxe());
  const clean: ScanReport = buildReport("https://clean.example.com/", "clean.example.com", 0, {
    violations: [],
    passes: [],
    incomplete: [],
  });
  assert.equal(decideExitCode([clean, hot], "critical", true), 1);
  assert.equal(decideExitCode([clean], "critical", true), 0);
});
