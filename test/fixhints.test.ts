import { test } from "node:test";
import assert from "node:assert/strict";
import { fixGuidanceFor, tripsCopyGuard } from "../src/fixhints.js";

// config.ts reads process.env fresh on every call (see config.ts's getConfig),
// so these scenarios can share one file/process and just mutate env between
// tests without any stale-module-cache risk.

test("fixGuidanceFor with no A11YSCAN_LLM_URL: axe fallback, zero network calls", async () => {
  delete process.env.A11YSCAN_LLM_URL;
  delete process.env.A11YSCAN_LLM_KEY;
  const result = await fixGuidanceFor([
    { id: "image-alt", description: "Images must have alt text", help: "Add an alt attribute", impact: "critical" },
  ]);
  assert.deepEqual(result.get("image-alt"), { text: "Add an alt attribute", source: "axe" });
});

test("REQUIRED: --fix-hints degrades to axe fallback when the LLM URL is a blocked loopback address, never throws", async () => {
  process.env.A11YSCAN_LLM_URL = "http://127.0.0.1:9999";
  process.env.A11YSCAN_LLM_KEY = "test-key";
  const rules = [
    { id: "color-contrast", description: "Contrast too low", help: "Increase contrast", impact: "serious" },
  ];
  const result = await fixGuidanceFor(rules);
  // The SSRF guard rejects 127.0.0.1 before any HTTP request is attempted, so
  // callLlm() returns null and the axe-help fallback stands — no throw, no hang.
  assert.deepEqual(result.get("color-contrast"), { text: "Increase contrast", source: "axe" });
  delete process.env.A11YSCAN_LLM_URL;
  delete process.env.A11YSCAN_LLM_KEY;
});

test("REQUIRED: --fix-hints degrades gracefully when the LLM URL is the cloud metadata address", async () => {
  process.env.A11YSCAN_LLM_URL = "http://169.254.169.254";
  process.env.A11YSCAN_LLM_KEY = "test-key";
  const rules = [{ id: "region", description: "Content not in a landmark", help: "Wrap in <main>", impact: "moderate" }];
  const result = await fixGuidanceFor(rules);
  assert.deepEqual(result.get("region"), { text: "Wrap in <main>", source: "axe" });
  delete process.env.A11YSCAN_LLM_URL;
  delete process.env.A11YSCAN_LLM_KEY;
});

test("fixGuidanceFor always covers every rule even if some are new", async () => {
  delete process.env.A11YSCAN_LLM_URL;
  const rules = [
    { id: "a", description: "d1", help: "h1", impact: "minor" },
    { id: "b", description: "d2", help: "h2", impact: "moderate" },
  ];
  const result = await fixGuidanceFor(rules);
  assert.equal(result.size, 2);
  assert.equal(result.get("a")?.text, "h1");
  assert.equal(result.get("b")?.text, "h2");
});

test("tripsCopyGuard rejects compliance-claim language, allows plain remediation text", () => {
  assert.equal(tripsCopyGuard("This fix makes the page fully WCAG compliant."), true);
  assert.equal(tripsCopyGuard("This guarantees ADA compliance."), true);
  assert.equal(tripsCopyGuard("Doing this is legally required."), true);
  assert.equal(tripsCopyGuard("Add an alt attribute describing the image content."), false);
});
