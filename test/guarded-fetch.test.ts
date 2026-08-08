import { test } from "node:test";
import assert from "node:assert/strict";
import { guardedFetch } from "../src/guarded-fetch.js";

// These exercise the exact call shape fixhints.ts uses for the --fix-hints
// LLM request. No live network call happens: validateUrl() rejects loopback
// and link-local literal IPs before pinnedFetch ever opens a socket.

test("REQUIRED: guardedFetch rejects a loopback target (127.0.0.1) without making a request", async () => {
  const result = await guardedFetch("http://127.0.0.1:4000/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    timeoutMs: 1000,
    maxBytes: 1000,
    resolver: async () => {
      throw new Error("resolver must not be called for a literal IP");
    },
  });
  assert.equal(result, null);
});

test("REQUIRED: guardedFetch rejects the cloud metadata address (169.254.169.254)", async () => {
  const result = await guardedFetch("http://169.254.169.254/latest/meta-data/", {
    method: "GET",
    headers: {},
    timeoutMs: 1000,
    maxBytes: 1000,
    resolver: async () => {
      throw new Error("resolver must not be called for a literal IP");
    },
  });
  assert.equal(result, null);
});

test("guardedFetch rejects a hostname that resolves to a private IP", async () => {
  const result = await guardedFetch("http://internal-gateway.example.com/v1/chat/completions", {
    method: "POST",
    headers: {},
    body: "{}",
    timeoutMs: 1000,
    maxBytes: 1000,
    resolver: async () => [{ ip: "10.0.0.5", family: 4 }],
  });
  assert.equal(result, null);
});

test("guardedFetch rejects an unreachable/unparseable URL gracefully", async () => {
  const result = await guardedFetch("not a url", {
    method: "GET",
    headers: {},
    timeoutMs: 1000,
    maxBytes: 1000,
  });
  assert.equal(result, null);
});
