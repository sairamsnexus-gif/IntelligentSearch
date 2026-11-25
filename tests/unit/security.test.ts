import { describe, expect, it } from "vitest";
import { assertSafeUrl, isPrivateAddress, safeFetch, SsrfError } from "@/lib/security/ssrf";
import { isAllowed, parseRobots } from "@/lib/security/robots";
import { redact } from "@/lib/security/logger";
import { SlidingWindowLimiter, mapWithConcurrency } from "@/lib/security/rate-limit";
import { hashPassword, signSession, verifyPassword, verifySession } from "@/lib/auth/session";
import { groundInText } from "@/lib/ai/assist";

describe("SSRF protection", () => {
  it("classifies private and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.4", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("rejects dangerous URLs before any network access", () => {
    for (const u of ["file:///etc/passwd", "http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://user:pw@example.com/", "http://example.com:8080/", "http://service.internal/", "gopher://x"]) {
      expect(() => assertSafeUrl(u), u).toThrow(SsrfError);
    }
    expect(assertSafeUrl("https://example.com/profile").hostname).toBe("example.com");
  });
  it("refuses to fetch loopback targets", async () => {
    await expect(safeFetch("http://127.0.0.1/")).rejects.toThrow(SsrfError);
  });
});

describe("robots.txt", () => {
  const rules = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/public\n\nUser-agent: OtherBot\nDisallow: /");
  it("honours disallow with longest-match allow", () => {
    expect(isAllowed(rules, "/profile")).toBe(true);
    expect(isAllowed(rules, "/private/x")).toBe(false);
    expect(isAllowed(rules, "/private/public/y")).toBe(true);
  });
});

describe("logging & secrets", () => {
  it("redacts secrets and sensitive fields", () => {
    const out = redact({ apiKey: "abc", email: "a@b.c", nested: { note: "key AIzaSyA1234567890abcdefghijklmnop", url: "https://x?key=SECRET&q=1" } }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted]");
    expect(out.email).toBe("[redacted]");
    expect(JSON.stringify(out)).not.toMatch(/AIza|SECRET/);
  });
});

describe("auth", () => {
  it("hashes and verifies passwords with scrypt", () => {
    const h = hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse battery", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
  it("signs sessions and rejects tampering or expiry", () => {
    const t = signSession({ uid: "u1", role: "admin", email: "a@b.c" });
    expect(verifySession(t)?.uid).toBe("u1");
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "u1", role: "admin", email: "a@b.c", exp: 9_999_999_999 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`)).toBeNull();
    expect(verifySession(`${body}.x${sig}`)).toBeNull();
    expect(verifySession(t, Date.now() + 13 * 3_600_000)).toBeNull();
  });
});

describe("rate limiting & concurrency", () => {
  it("limits requests per window", () => {
    const l = new SlidingWindowLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => l.check("k", 0).ok)).toEqual([true, true, true, false]);
    expect(l.check("k", 1500).ok).toBe(true);
  });
  it("caps parallelism", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }), 3, async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBe(3);
  });
});

describe("AI grounding", () => {
  it("drops AI-extracted values that are not in the source text", () => {
    const g = groundInText({ city: "Chennai", organization: "Google", previous_organizations: ["Infosys", "Wipro"], approximate_age: 40 }, "Lives in Chennai, ex-Infosys, around 40");
    expect(g.city).toBe("Chennai");
    expect(g.organization).toBeNull();
    expect(g.previous_organizations).toEqual(["Infosys"]);
    expect(g.approximate_age).toBe(40);
  });
});
