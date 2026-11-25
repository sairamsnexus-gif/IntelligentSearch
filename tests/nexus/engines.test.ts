/**
 * Real engine adapters against local mock services (SearXNG JSON API,
 * SpiderFoot REST, GPT Researcher sidecar, Maigret sidecar). Verifies request
 * shapes, job polling, quota mapping and the SpiderFoot free-module allowlist.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/config/env";
import { executeTask, engineStatus, SPIDERFOOT_MODULES } from "@/lib/nexus/engines";
import type { ExecuteRequest } from "@/lib/nexus/engine-types";

let server: http.Server;
let base = "";
const seen: { method: string; url: string; body: string }[] = [];
let searxStatus = 200;
let sfPolls = 0;
let robotsOnly: boolean | string = false;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, body });
      const json = (code: number, v: unknown) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(v));
      };
      const u = new URL(req.url!, "http://x");
      if (u.pathname === "/search") return searxStatus === 200 ? json(200, { results: [{ url: "https://a.example/x", title: "<b>A</b>", content: "about <i>Asma</i>", engine: "duckduckgo" }] }) : json(searxStatus, { error: "x" });
      if (u.pathname === "/optsraw") return json(200, ["SUCCESS", { token: 1, data: { "sfp_spider:robotsonly": robotsOnly } }]);
      if (u.pathname === "/startscan") return json(200, ["SUCCESS", "SCAN123"]);
      if (u.pathname === "/scanstatus") return json(200, ["n", "t", "c", "s", "e", ++sfPolls < 2 ? "RUNNING" : "FINISHED", {}]);
      if (u.pathname === "/scaneventresults") return json(200, [["2026-01-01", "sivasma-exports.example", "src", "sfp_spider", 100, 100, 0, "h", "sh", "", "AFFILIATE_INTERNET_NAME"], ["2026-01-01", "Sivasma &amp; Co", "src", "sfp_company", 100, 100, 0, "h", "sh", "", "COMPANY_NAME"]]);
      if (u.pathname === "/research" && req.method === "POST") return json(200, { job_id: "J1" });
      if (u.pathname === "/research/J1") return json(200, { status: "done", report: "notes", sources: [{ url: "https://b.example/", title: "B", excerpt: "e" }], failed: [{ url: "https://www.instagram.com/x", reason: "robots" }], queries: ["q"], llm_calls: 2 });
      if (u.pathname === "/username") return json(200, { found: [{ site: "GitHub", url: "https://github.com/sivasma" }] });
      json(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  for (const k of ["NEXUS_HOSTED", "NETLIFY"]) delete process.env[k];
  Object.assign(process.env, { SEARXNG_URL: base, SPIDERFOOT_URL: base, GPTR_SERVICE_URL: base, MAIGRET_SERVICE_URL: base, NEXUS_SYNTHETIC: "false" });
  resetEnvCache();
  seen.length = 0;
});

const req = (engine: ExecuteRequest["task"]["engine"], kind: ExecuteRequest["task"]["kind"], input: ExecuteRequest["task"]["input"], jobRef?: string): ExecuteRequest => ({
  task: { id: "task_1", engine, kind, input, jobRef },
  context: { synthetic: false, clueNames: ["Asma"], places: ["Chennai"], organisationHints: [], llm: { enabled: false, remainingCalls: 0, maxTokensPerCall: 500 } },
});

describe("engine adapters (operator mode, mock services)", () => {
  it("SearXNG: JSON search → hits; 429 → quota (no fallback)", async () => {
    const r = await executeTask(req("searxng", "search", { query: '"Asma" Chennai' }));
    expect(r.status).toBe("done");
    expect(r.hits?.[0]).toMatchObject({ url: "https://a.example/x", title: "A", snippet: "about Asma" });
    expect(seen[0].url).toContain("format=json");
    searxStatus = 429;
    const q = await executeTask(req("searxng", "search", { query: "x" }));
    searxStatus = 200;
    expect(q.status).toBe("quota");
    expect(seen.filter((s) => s.url.startsWith("/search")).length).toBe(2);
  });

  it("SpiderFoot: allowlisted free modules only; sfp_spider dropped unless robotsonly is on; polls to completion", async () => {
    const start = await executeTask(req("spiderfoot", "osint_domain", { domain: "sivasma-garments.example" }));
    expect(start.status).toBe("pending");
    const form = new URLSearchParams(seen.find((s) => s.url === "/startscan")!.body);
    const mods = form.get("modulelist")!.split(",").map((m) => m.replace("module_", ""));
    expect(mods.every((m) => SPIDERFOOT_MODULES.includes(m))).toBe(true);
    expect(mods).not.toContain("sfp_spider");
    expect(start.notes?.join(" ")).toMatch(/robotsonly/);
    robotsOnly = true;
    await executeTask(req("spiderfoot", "osint_domain", { domain: "sivasma-garments.example" }));
    expect(new URLSearchParams(seen.filter((s) => s.url === "/startscan").pop()!.body).get("modulelist")).toContain("module_sfp_spider");
    sfPolls = 0;
    const p1 = await executeTask(req("spiderfoot", "osint_domain", { domain: "sivasma-garments.example" }, "SCAN123"));
    expect(p1.status).toBe("pending");
    const p2 = await executeTask(req("spiderfoot", "osint_domain", { domain: "sivasma-garments.example" }, "SCAN123"));
    expect(p2.status).toBe("done");
    expect(p2.osint).toEqual([
      { type: "AFFILIATE_INTERNET_NAME", value: "sivasma-exports.example", module: "sfp_spider" },
      { type: "COMPANY_NAME", value: "Sivasma & Co", module: "sfp_company" },
    ]);
    const bad = await executeTask(req("spiderfoot", "osint_domain", { domain: "not a domain" }));
    expect(bad.status).toBe("failed");
  });

  it("GPT Researcher sidecar: job → poll → research output with failures listed", async () => {
    const s = await executeTask(req("gpt_researcher", "research", { query: "Who runs Little Lotus Montessori?" }));
    expect(s).toMatchObject({ status: "pending", job: { ref: "J1" } });
    const d = await executeTask(req("gpt_researcher", "research", { query: "q" }, "J1"));
    expect(d.status).toBe("done");
    expect(d.research?.sources[0].url).toBe("https://b.example/");
    expect(d.research?.failed[0].reason).toBe("robots");
  });

  it("Maigret sidecar: profiles flagged as existence-only", async () => {
    const r = await executeTask(req("maigret", "username", { username: "sivasma" }));
    expect(r.profiles?.[0]).toMatchObject({ site: "GitHub", url: "https://github.com/sivasma" });
    expect(r.profiles?.[0].note).toMatch(/ownership not established/);
    expect((await executeTask(req("maigret", "username", { username: "bad user!" }))).status).toBe("failed");
  });

  it("Page investigator refuses private/loopback targets (SSRF) and sign-in walled platforms", async () => {
    const r = await executeTask(req("page", "read_page", { url: `${base}/search` }));
    expect(r.pages?.[0].fetchStatus).toBe("unsafe_url");
    const ig = await executeTask(req("page", "read_page", { url: "https://www.instagram.com/someone" }));
    expect(ig.pages?.[0].fetchStatus).toBe("login_wall");
  });

  it("hosted mode marks loopback services unreachable and reports them unavailable (no fabricated results)", async () => {
    process.env.NEXUS_HOSTED = "true";
    resetEnvCache();
    expect(engineStatus("searxng").available).toBe(false);
    expect(engineStatus("page").available).toBe(true);
    const r = await executeTask(req("searxng", "search", { query: "x" }));
    expect(r.status).toBe("unavailable");
    expect(seen.length).toBe(0);
  });
});
