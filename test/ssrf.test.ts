import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIp, SsrfError, validateUrl, type Resolver } from "../src/ssrf.js";

// A resolver that maps hostnames to fixed IPs, so range logic is deterministic
// and no real DNS is touched.
function resolverFor(map: Record<string, string[]>): Resolver {
  return async (hostname: string) => {
    const ips = map[hostname];
    if (!ips) throw new Error("NXDOMAIN");
    return ips.map((ip) => ({ ip, family: (ip.includes(":") ? 6 : 4) as 4 | 6 }));
  };
}

async function rejects(url: string, resolver?: Resolver): Promise<SsrfError> {
  try {
    await validateUrl(url, resolver);
  } catch (e) {
    assert.ok(e instanceof SsrfError, `expected SsrfError for ${url}, got ${e}`);
    return e;
  }
  assert.fail(`expected ${url} to be rejected`);
}

test("classifyIp flags private / reserved ranges and allows public unicast", () => {
  assert.equal(classifyIp("169.254.169.254"), "ipv4:linkLocal");
  assert.equal(classifyIp("192.168.1.1"), "ipv4:private");
  assert.equal(classifyIp("10.0.0.5"), "ipv4:private");
  assert.equal(classifyIp("127.0.0.1"), "ipv4:loopback");
  assert.equal(classifyIp("0.0.0.0"), "ipv4:unspecified");
  assert.equal(classifyIp("::1"), "ipv6:loopback");
  assert.equal(classifyIp("fe80::1"), "ipv6:linkLocal");
  assert.equal(classifyIp("8.8.8.8"), null);
  assert.equal(classifyIp("93.184.216.34"), null);
});

test("REQUIRED: internal fetch guard rejects the cloud metadata IP (169.254.169.254)", async () => {
  const e = await rejects("http://169.254.169.254/latest/meta-data/");
  assert.equal(e.code, "private-ip");
});

test("REQUIRED: internal fetch guard rejects a loopback URL (127.0.0.1)", async () => {
  const e = await rejects("http://127.0.0.1/v1/chat/completions");
  assert.equal(e.code, "private-ip");
});

test("REQUIRED: internal fetch guard rejects 'localhost' by hostname, not just by IP", async () => {
  assert.equal((await rejects("http://localhost/")).code, "blocked-host");
  assert.equal((await rejects("http://localhost:4000/v1/chat/completions")).code, "blocked-host");
});

test("REQUIRED: RFC1918 literal IPs are rejected", async () => {
  assert.equal((await rejects("http://192.168.1.1/")).code, "private-ip");
  assert.equal((await rejects("http://10.0.0.5/")).code, "private-ip");
  assert.equal((await rejects("http://172.16.0.9/")).code, "private-ip");
});

test("a hostname resolving to a private IP is rejected (no real DNS touched)", async () => {
  const resolver = resolverFor({ "internal.example.com": ["8.8.8.8", "192.168.0.10"] });
  const e = await rejects("http://internal.example.com/", resolver);
  assert.equal(e.code, "private-ip");
});

test("non-http(s) schemes and embedded credentials are rejected", async () => {
  assert.equal((await rejects("ftp://example.com/")).code, "bad-scheme");
  assert.equal((await rejects("file:///etc/passwd")).code, "bad-scheme");
  assert.equal((await rejects("http://user:pass@example.com/")).code, "userinfo");
});

test("bare single-label hosts are rejected", async () => {
  assert.equal((await rejects("http://intranet/")).code, "bare-host");
});

test("a public host passes and pins its resolved IP", async () => {
  const resolver = resolverFor({ "example.com": ["93.184.216.34"] });
  const r = await validateUrl("https://example.com/path", resolver);
  assert.equal(r.hostname, "example.com");
  assert.deepEqual(r.resolvedIps, ["93.184.216.34"]);
  assert.equal(r.pinnedIp, "93.184.216.34");
});
