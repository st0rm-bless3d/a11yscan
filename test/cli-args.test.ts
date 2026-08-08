import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, UsageError } from "../src/cli.js";

test("parseArgs: defaults with just a URL", () => {
  const args = parseArgs(["https://example.com"]);
  assert.deepEqual(args, {
    urls: ["https://example.com"],
    json: false,
    minImpact: "minor",
    exitCode: false,
    fixHints: false,
    help: false,
  });
});

test("parseArgs: collects multiple positional URLs and all flags", () => {
  const args = parseArgs([
    "https://a.example.com",
    "https://b.example.com",
    "--json",
    "--min-impact",
    "serious",
    "--exit-code",
    "--fix-hints",
  ]);
  assert.deepEqual(args.urls, ["https://a.example.com", "https://b.example.com"]);
  assert.equal(args.json, true);
  assert.equal(args.minImpact, "serious");
  assert.equal(args.exitCode, true);
  assert.equal(args.fixHints, true);
});

test("parseArgs: --min-impact=value form is accepted", () => {
  const args = parseArgs(["https://example.com", "--min-impact=critical"]);
  assert.equal(args.minImpact, "critical");
});

test("parseArgs: --min-impact requires a valid level, throws UsageError otherwise", () => {
  assert.throws(() => parseArgs(["https://example.com", "--min-impact"]), UsageError);
  assert.throws(() => parseArgs(["https://example.com", "--min-impact", "extreme"]), UsageError);
});

test("parseArgs: unknown flags are rejected", () => {
  assert.throws(() => parseArgs(["https://example.com", "--bogus"]), UsageError);
});

test("parseArgs: -h/--help sets help regardless of other args", () => {
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(parseArgs(["https://example.com", "--help"]).help, true);
});
