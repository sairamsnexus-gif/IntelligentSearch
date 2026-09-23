import "server-only";
/**
 * SSRF-safe fetching for URLs that originate from users or from search
 * results. Guarantees:
 *  - http/https only, default ports only (80/443), no userinfo in URL
 *  - hostname resolved and EVERY address checked against private/reserved ranges
 *  - the validated address is pinned for the actual connection (no DNS rebinding)
 *  - redirects followed manually (max 3) and re-validated at each hop
 *  - response size cap, timeout, content-type allow-list
 *
 * Operator-configured service URLs (SearXNG, Maigret sidecar…) do NOT go
 * through this path — they are trusted configuration, not user input.
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (/^f[cd]/.test(v)) return true; // unique local fc00::/7
    if (/^fe[89ab]/.test(v)) return true; // link-local fe80::/10
    if (/^ff/.test(v)) return true; // multicast
    if (v.startsWith("2001:db8")) return true; // documentation
    if (v.startsWith("64:ff9b")) return true; // NAT64
    return false;
  }
  return true;
}

const BLOCKED_HOST = /(^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home$|^metadata\.google\.internal$)/i;

export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SsrfError("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SsrfError("Only http/https URLs are allowed");
  if (u.username || u.password) throw new SsrfError("Credentials in URLs are not allowed");
  if (u.port && !["80", "443"].includes(u.port)) throw new SsrfError("Non-standard ports are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOST.test(host)) throw new SsrfError("Internal hostnames are not allowed");
  if (net.isIP(host) && isPrivateAddress(host)) throw new SsrfError("Private or reserved addresses are not allowed");
  return u;
}

export async function resolvePublic(hostname: string): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new SsrfError("Private or reserved addresses are not allowed");
    return { address: host, family: net.isIPv6(host) ? 6 : 4 };
  }
  const addrs = await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw new SsrfError("Host did not resolve");
  for (const a of addrs) if (isPrivateAddress(a.address)) throw new SsrfError("Host resolves to a private or reserved address");
  return addrs[0];
}

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  accept?: string;
}

const ALLOWED_TYPES = /^(text\/|application\/(json|xml|rss\+xml|atom\+xml|xhtml\+xml|ld\+json))/i;

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let current = rawUrl;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const u = assertSafeUrl(current);
    const pinned = await resolvePublic(u.hostname);
    const lookup: LookupFunction = (_host, options, cb) => {
      if (typeof options === "object" && options && "all" in options && options.all) {
        (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [pinned]);
      } else cb(null, pinned.address, pinned.family);
    };
    const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.request(
        u,
        {
          method: "GET",
          lookup,
          timeout: timeoutMs,
          headers: {
            "user-agent": opts.userAgent ?? "IntelligentSearchBot/1.0 (+public-source monitoring; respects robots.txt)",
            accept: opts.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
            "accept-encoding": "identity",
          },
        },
        (resp) => {
          const status = resp.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            resp.resume();
            resolve({ status, headers: resp.headers, body: "" });
            return;
          }
          const ct = String(resp.headers["content-type"] ?? "");
          if (ct && !ALLOWED_TYPES.test(ct)) {
            resp.destroy();
            resolve({ status: 415, headers: resp.headers, body: "" });
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          resp.on("data", (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              resp.destroy();
              return;
            }
            chunks.push(c);
          });
          resp.on("end", () => resolve({ status, headers: resp.headers, body: Buffer.concat(chunks).toString("utf8") }));
          resp.on("close", () => resolve({ status, headers: resp.headers, body: Buffer.concat(chunks).toString("utf8") }));
          resp.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("Request timed out")));
      req.on("error", reject);
      req.end();
    });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, u).toString();
      continue;
    }
    return { url: u.toString(), status: res.status, contentType: String(res.headers["content-type"] ?? ""), body: res.body };
  }
  throw new SsrfError("Too many redirects");
}
