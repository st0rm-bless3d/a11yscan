// SSRF defense for the CLI's OWN outbound calls (the --fix-hints LLM request
// and any future internal URL fetch). This is NOT applied to the site you ask
// a11yscan to scan — Playwright navigating to your target URL is the tool's
// normal job, same trust model as pa11y/axe-cli (see README "Security").
//
// The same logic also gates an attacker-supplied scan target in a hosted
// service. Here it gates a config value the CLI operator sets themselves
// (A11YSCAN_LLM_URL). We keep it anyway as defense in depth: a compromised or
// mistyped config value should not be able to make this process reach
// internal network services silently. One consequence documented in the
// README: an LLM gateway bound to 127.0.0.1/localhost is rejected by design
// — point it at a LAN hostname or IP instead.
//
// Policy:
//   - Only http/https URLs.
//   - Resolve the hostname to ALL of its A/AAAA records; reject if ANY resolved
//     IP is outside the public unicast ranges (private / loopback / link-local /
//     CGNAT / reserved / multicast / unspecified / ULA / IPv4-mapped, incl.
//     169.254.169.254 cloud metadata).
//   - Reject literal IPs in those ranges and obvious internal names (localhost,
//     *.local, *.internal, bare hostnames with no dot).
//   - Pin: the first validated public IP is returned so the caller can pin the
//     TCP connection to it (see pinnedfetch.ts).
//
// ipaddr.js does the range classification (battle-tested; hand-rolling CIDR
// math for every reserved range is exactly the kind of thing you get subtly
// wrong). We treat its `.range()` output as the source of truth.

import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export interface ResolvedHost {
  ip: string;
  family: 4 | 6;
}

// Injectable resolver so tests can exercise the range logic deterministically
// without real DNS.
export type Resolver = (hostname: string) => Promise<ResolvedHost[]>;

const defaultResolver: Resolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ ip: r.address, family: r.family as 4 | 6 }));
};

export class SsrfError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SsrfError";
    this.code = code;
  }
}

// IPv4 ranges (ipaddr.js .range() values) that are NOT public unicast.
const BLOCKED_V4_RANGES = new Set([
  "unspecified", // 0.0.0.0/8
  "broadcast", // 255.255.255.255
  "multicast", // 224.0.0.0/4
  "linkLocal", // 169.254.0.0/16 (incl. 169.254.169.254 metadata)
  "loopback", // 127.0.0.0/8
  "carrierGradeNat", // 100.64.0.0/10
  "private", // 10/8, 172.16/12, 192.168/16
  "reserved", // 240.0.0.0/4 etc.
]);

// IPv6 ranges that are NOT public unicast.
const BLOCKED_V6_RANGES = new Set([
  "unspecified", // ::
  "linkLocal", // fe80::/10
  "multicast", // ff00::/8
  "loopback", // ::1
  "uniqueLocal", // fc00::/7
  "ipv4Mapped", // ::ffff:0:0/96 (handled by unwrap below too)
  "rfc6145",
  "rfc6052",
  "6to4",
  "teredo",
  "reserved",
]);

/**
 * Classify a single IP string. Returns null if the IP is a public unicast
 * address; otherwise returns the reason it is blocked.
 */
export function classifyIp(ipStr: string): string | null {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ipStr);
  } catch {
    return "unparseable-ip";
  }

  // Unwrap IPv4-mapped / 6to4-style IPv6 so we judge the real v4 address.
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      const v4 = v6.toIPv4Address();
      const r = v4.range();
      return BLOCKED_V4_RANGES.has(r) ? `ipv4mapped:${r}` : null;
    }
    const r = v6.range();
    if (BLOCKED_V6_RANGES.has(r)) return `ipv6:${r}`;
    return null;
  }

  const r = (addr as ipaddr.IPv4).range();
  if (BLOCKED_V4_RANGES.has(r)) return `ipv4:${r}`;
  return null;
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h === "localhost") return true;
  if (h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  if (h.endsWith(".internal")) return true;
  if (h.endsWith(".lan")) return true;
  // Metadata service hostnames used by cloud providers.
  if (h === "metadata" || h === "metadata.google.internal") return true;
  return false;
}

export interface ValidationResult {
  url: URL;
  hostname: string;
  resolvedIps: string[];
  // The pinned IP the caller should expect on subsequent re-resolutions.
  pinnedIp: string;
}

/**
 * Validate a URL for SSRF safety before the CLI makes a request to it.
 * Throws SsrfError on rejection.
 */
export async function validateUrl(
  rawUrl: string,
  resolver: Resolver = defaultResolver,
): Promise<ValidationResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("invalid-url", "Could not parse the URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError("bad-scheme", "Only http and https URLs are supported.");
  }

  // No embedded credentials (userinfo can be used to confuse parsers).
  if (url.username || url.password) {
    throw new SsrfError("userinfo", "URLs with embedded credentials are rejected.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) {
    throw new SsrfError("no-host", "URL has no host.");
  }

  if (isBlockedHostname(hostname)) {
    throw new SsrfError("blocked-host", `Host "${hostname}" is not a public host.`);
  }

  // If the host is a literal IP, classify it directly (no DNS).
  if (ipaddr.isValid(hostname)) {
    const reason = classifyIp(hostname);
    if (reason) {
      throw new SsrfError("private-ip", `Target IP is not public (${reason}).`);
    }
    return { url, hostname, resolvedIps: [hostname], pinnedIp: hostname };
  }

  // A bare single-label hostname (no dot) is almost always internal.
  if (!hostname.includes(".")) {
    throw new SsrfError("bare-host", `Host "${hostname}" is not a public domain.`);
  }

  let resolved: ResolvedHost[];
  try {
    resolved = await resolver(hostname);
  } catch {
    throw new SsrfError("dns-failure", `Could not resolve "${hostname}".`);
  }

  if (resolved.length === 0) {
    throw new SsrfError("dns-empty", `"${hostname}" did not resolve to any address.`);
  }

  const ips: string[] = [];
  for (const { ip } of resolved) {
    const reason = classifyIp(ip);
    if (reason) {
      throw new SsrfError("private-ip", `"${hostname}" resolves to a non-public address (${reason}).`);
    }
    ips.push(ip);
  }

  const pinnedIp = ips[0]!;
  return { url, hostname, resolvedIps: ips, pinnedIp };
}
