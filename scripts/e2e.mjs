/**
 * Browser walkthrough of the acceptance criteria against a running app in demo mode.
 *   BASE_URL=http://localhost:3000 E2E_EMAIL=... E2E_PASSWORD=... npm run e2e
 * Use a fresh database (first run creates the admin via /setup).
 * Screenshots are written to ./e2e-artifacts/.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "correct-horse-battery";
const OUT = process.env.E2E_OUT ?? "e2e-artifacts";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (n, ok, detail = "") => {
  results.push({ n, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(60_000);
page.on("dialog", (d) => void d.accept());
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

try {
  // 1. Open the application (first run → setup, otherwise login)
  await page.goto(BASE);
  await page.waitForURL(/\/(login|setup)/);
  await page.waitForTimeout(800);
  if (page.url().includes("/setup")) {
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
  } else {
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
  }
  // ---------------- NEXUS workspace (synthetic world) ----------------
  await page.waitForSelector('[data-testid="nexus-request"]');
  check("N1 NEXUS workspace is the home page", true);
  await page.fill('[data-testid="nexus-request"]', "Find Asma and Siva in Chennai. They may be running a garments business. Asma may also be associated with a Montessori school.");
  if (!(await page.isChecked('[data-testid="nexus-synthetic"]'))) await page.check('[data-testid="nexus-synthetic"]');
  await page.click('[data-testid="nexus-start"]');
  await page.waitForFunction(() => document.querySelector('[data-testid=nexus-status]')?.textContent === "completed", null, { timeout: 120_000 });
  check("N2 Multi-engine investigation completes", true, (await page.textContent('[data-testid="nexus-stop-reason"]')) ?? "");
  const clueTxt = (await page.locator('[data-testid="nexus-clue-name"]').allTextContents()).join(" ");
  check("N3 Exact names kept + Tamil variants", /Asma/.test(clueTxt) && /Siva/.test(clueTxt) && clueTxt.includes("சிவா") && clueTxt.includes("அஸ்மா"));
  check("N4 Graph shows evidence-backed entities", (await page.locator('[data-testid="nexus-graph-node"]').count()) >= 6);
  check("N5 Synthetic data is clearly labelled", await page.isVisible('[data-testid="nexus-synthetic-banner"]'));
  check("N6 Free-quota event shown, other engines continued", await page.isVisible('[data-testid="nexus-quota"]'));
  await shot("N1-nexus-complete");
  const tab = (re) => page.getByRole("tab", { name: re }).click();
  await tab(/Engine findings/);
  check("N7 A · Engine findings (per engine)", (await page.locator('[data-testid="nexus-findings"] > li').count()) > 0);
  await tab(/Possible matches/);
  check("N8 B · Possible matches with matches/conflicts/unknowns", (await page.locator('[data-testid="nexus-match"]').count()) >= 3 && (await page.textContent('[data-testid="nexus-matches"]')).includes("Unknown"));
  await page.locator('[data-testid="nexus-confirm"]').first().click();
  check("N9 User confirm decision", (await page.textContent('[data-testid="nexus-matches"]')).includes("Confirmed"));
  await shot("N2-nexus-matches");
  await tab(/Relationships/);
  check("N10 C · Relationships with evidence quotes", (await page.locator('[data-testid="nexus-relationships"] blockquote').count()) > 0);
  await tab(/Source evidence/);
  const ev = await page.textContent('[data-testid="nexus-evidence"]');
  check("N11 D · Evidence ledger (copy group, robots-blocked, contradiction)", ev.includes("copy group") && ev.includes("blocked robots") && ev.includes("Contradicted"));
  await tab(/Investigation trail/);
  check("N12 E · Investigation trail", (await page.locator('[data-testid="nexus-trail"] li').count()) > 10);
  await tab(/Unresolved leads/);
  check("N13 F · Unresolved leads", await page.isVisible('[data-testid="nexus-tab-leads"]'));
  await tab(/Public contacts/);
  check("N14 Public contacts attributed to organisations", (await page.textContent('[data-testid="nexus-contacts"]')).includes("info@sivasma-garments.example"));
  await tab(/Coverage/);
  check("N15 Coverage / reconciliation", (await page.textContent('[data-testid="nexus-coverage"]')).includes("Inaccessible"));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-testid="nexus-export"]')]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  check("N16 JSON export (versioned, no secrets)", exported.schema === "nexus.investigation" && exported.schemaVersion === 1 && !JSON.stringify(exported).match(/FREELLMAPI_API_KEY|Bearer /));
  check("N17 Workspace not cleared after export", await page.isVisible('[data-testid="nexus-graph"]'));
  await page.reload();
  await page.waitForSelector('[data-testid="nexus-recovery"]');
  await page.click('[data-testid="nexus-restore"]');
  await page.waitForSelector('[data-testid="nexus-graph"]');
  check("N18 IndexedDB autosave recovery", true);
  await page.setInputFiles('[data-testid="nexus-import"]', { name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"schema":"other"}') });
  await page.waitForFunction(() => document.querySelector('[data-testid=nexus-message]')?.textContent?.includes("Import rejected"), null, { timeout: 10_000 }).catch(() => null);
  check("N19 Import validation rejects foreign files", ((await page.textContent('[data-testid="nexus-message"]')) ?? "").includes("Import rejected"));
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.context().addCookies(await page.context().cookies());
  await mobile.goto(BASE);
  await mobile.waitForSelector('[data-testid="nexus-request"]');
  check("N20 Mobile layout without horizontal scroll", (await mobile.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await mobile.screenshot({ path: `${OUT}/N3-nexus-mobile.png` });
  await mobile.close();

  // ---------------- Legacy person-search console ----------------
  await page.goto(`${BASE}/person-search`);
  await page.waitForSelector('[data-testid="find-person-form"]');
  check("1  Open application", true);
  await shot("01-empty-search");

  // 2-5. Enter name, expand details, enter attributes, search
  await page.fill("#name", "Rajesh Kumar");
  await page.click('[data-testid="toggle-details"]');
  await page.fill("#city", "Chennai");
  await page.fill("#country", "India");
  await page.fill("#organization", "TCS");
  await page.fill("#designation", "Project Manager");
  check("2-4 Name + additional details entered", true);
  await page.check('[data-testid="attest"]');
  await page.click('[data-testid="search-person"]');
  await page.waitForURL(/\?s=/);
  check("5  SEARCH PERSON", true);

  // 6-8. Searches execute, permutations, coverage
  await page.waitForSelector('[data-testid="progress-count"]');
  await page.waitForTimeout(1500);
  await shot("02-search-in-progress");
  const progressText = await page.textContent('[data-testid="progress-count"]');
  check("6  Generated searches execute", /\d+ \/ \d+ searches completed/.test(progressText ?? ""), progressText ?? "");
  await page.waitForSelector('[data-testid="refine-box"]', { timeout: 120_000 });
  await page.click('[data-testid="view-queries"]');
  await page.waitForSelector('[role="dialog"] table');
  const qText = await page.textContent('[role="dialog"]');
  check("7  Search permutations visible", qText.includes('"Rajesh Kumar" TCS Chennai') && qText.includes('"Rajesh Kumar" Infosys'), "iteration 1 + discovered iteration 2 queries");
  await shot("03-query-history");
  await page.keyboard.press("Escape");
  const cov = await page.textContent('[data-testid="coverage"]');
  check("8  Source coverage shown", cov.includes("LinkedIn"), cov.replace(/\s+/g, " ").slice(0, 80));

  // 9-11. Candidates, matching attributes, evidence
  const cards = await page.$$('[data-testid="candidate-card"]');
  check("9  Candidate people shown", cards.length >= 3, `${cards.length} candidates`);
  const ui1 = await page.textContent('[data-testid="ui-state"]');
  check("   Ambiguity → ask for more information", ui1.includes("ASK FOR MORE INFORMATION"), ui1);
  const score = await page.textContent('[data-testid="match-score"]');
  check("10 Matching attributes (MATCHES x/y)", /\d+\/\d+/.test(score), score);
  await shot("04-candidates-ambiguous");
  await page.click('[data-testid="view-evidence"]');
  await page.waitForSelector('[data-testid="evidence-doc"]');
  const docs = await page.$$('[data-testid="evidence-doc"]');
  check("11 Evidence inspectable", docs.length > 0, `${docs.length} documents`);
  await shot("05-evidence");
  await page.keyboard.press("Escape");

  // 12-14. Add another attribute, search again, narrowed
  const firstBefore = await page.getAttribute('[data-testid="candidate-card"]', "data-candidate");
  await page.fill('[data-testid="refine-value"]', "Infosys");
  await page.click('[data-testid="refine-submit"]');
  check("12 Add another attribute", true, "previous company = Infosys");
  await page.waitForFunction(() => document.querySelector('[data-testid="ui-state"]')?.textContent?.includes("DISCOVERY RESULTS"), null, { timeout: 120_000 });
  check("13 Search again", true);
  const top = await page.textContent('[data-testid="candidate-card"] [data-testid="match-score"]');
  const [m, t] = top.split("/").map(Number);
  check("14 Candidates narrowed (leading candidate)", m === t, `top candidate ${top}; before: ${firstBefore}`);
  await shot("06-candidates-narrowed");

  // 15-16. Select candidate, lock
  await page.click('[data-testid="candidate-card"] [data-testid="select-person"]');
  await page.waitForSelector('[data-testid="confirm-dialog"]');
  const lockDisabled = await page.isDisabled('[data-testid="lock-person"]');
  check("15 Select candidate (explicit confirmation required)", lockDisabled, "lock disabled until confirmed");
  await shot("07-person-confirmed-dialog");
  await page.check('[data-testid="confirm-checkbox"]');
  await page.click('[data-testid="lock-person"]');
  await page.waitForURL(/\/persons\//);
  check("16 Lock person", true, page.url());

  // 17-19. Identity profile, identifiers, monitoring
  await page.waitForSelector('[data-testid="person-public-id"]');
  const pid = await page.textContent('[data-testid="person-public-id"]');
  check("17 Identity profile", /^PERSON-\d{6}$/.test(pid), pid);
  const ids = await page.textContent('[data-testid="known-identifiers"]');
  check("18 Confirmed identifiers", ids.includes("rajeshkumar78") && ids.includes("rajeshkumar-pm-chennai"), "LinkedIn / GitHub / YouTube");
  const mon = await page.textContent('[data-testid="monitoring-status"]');
  check("19 Monitoring started", /MONITORING ACTIVE|SCANNING/.test(mon), mon);
  await page.waitForTimeout(2500);
  await shot("08-monitor-mode");

  // 20-26. Manual scan → new/changed/existing, source URL, dates
  await page.click('[data-testid="run-scan"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="run-scan"]')?.textContent?.includes("Scanning"), null, { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="run-scan"]')?.textContent?.includes("Run manual scan") && !document.querySelector('[data-testid="run-scan"]')?.hasAttribute("disabled"), null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  check("20 Manual monitoring scan", true);
  await page.click('role=tab[name=/Sources/]');
  const src = await page.textContent('[data-testid="sources-table"]');
  check("21 Existing sources", src.includes("EXISTING"));
  check("25 First-seen date", /\d{2} \w{3,4} \d{4}/.test(src));
  check("26 Last-checked date", src.includes("NO LONGER AVAILABLE") || src.includes("CHANGED"));
  await shot("09-sources");
  await page.click('role=tab[name=/Changes/]');
  const types = await page.$$eval('[data-testid="change-item"]', (els) => els.map((e) => e.getAttribute("data-type")));
  check("22 New information", types.includes("NEW"), types.join(","));
  check("23 Changed information", types.includes("CHANGED"));
  await page.click('[data-testid="change-item"][data-type="CHANGED"] [data-testid="compare-changes"]');
  await shot("10-changes-diff");
  const href = await page.getAttribute('[data-testid="change-item"] a', "href");
  check("24 Original source URL openable", Boolean(href), href);

  await page.click('role=tab[name=/Timeline/]');
  const tl = await page.textContent('[data-testid="timeline"]');
  check("27 Timeline", tl.includes("Person discovered") && tl.includes("New article detected"));
  await shot("11-timeline");

  // 28-30. Add identifier → same person → future searches
  await page.click('[data-testid="add-information"]');
  await page.fill('[data-testid="add-info-value"]', "rajeshkumar78");
  await page.click('[data-testid="verify-identifier"]');
  await page.waitForSelector('[data-testid="verification-report"]');
  await shot("12-verify-identifier");
  const rep = await page.textContent('[data-testid="verification-report"]');
  await page.check('[data-testid="add-info-confirm"]');
  await page.click('[data-testid="add-info-submit"]');
  await page.waitForTimeout(2500);
  await page.click('role=tab[name=/Identity/]');
  const ids2 = await page.textContent('[data-testid="known-identifiers"]');
  check("28 Add identifier", rep.includes("Corroborated"), rep.replace(/\s+/g, " ").slice(0, 90));
  const samePid = await page.textContent('[data-testid="person-public-id"]');
  check("29 Added to SAME person", samePid === pid && /Instagram\s*rajeshkumar78\s*✓/.test(ids2), samePid);
  await page.click('role=tab[name=/Monitoring/]');
  await page.waitForSelector('[data-testid="search-plan"] li');
  const plan = await page.textContent('[data-testid="search-plan"]');
  check("30 Used in future searches", plan.includes("rajeshkumar78"));
  await shot("13-search-plan");

  // 31-33. Admin
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('[data-testid="person-row"]');
  const rows = await page.$$('[data-testid="person-row"]');
  check("31-32 Admin shows monitored people", rows.length >= 1, `${rows.length} row(s)`);
  await page.click('[data-testid="admin-pause"]');
  await page.waitForSelector('[data-testid="admin-resume"]');
  await page.click('[data-testid="admin-resume"]');
  await page.waitForSelector('[data-testid="admin-pause"]');
  check("33 Pause / resume monitoring", true);
  await shot("14-admin");
  await page.goto(`${BASE}/monitor`);
  await page.waitForSelector('[data-testid="person-row"]');
  await shot("15-monitor-dashboard");

  // 34. Demo mode without API keys
  await page.goto(`${BASE}/demo-source?url=${encodeURIComponent("https://www.linkedin.com/in/rajeshkumar-pm-chennai")}`);
  const demo = await page.textContent("body");
  check("34 Demo mode without API keys (labelled DEMO DATA)", demo.includes("DEMO DATA") && demo.includes("Senior Project Manager"));
} catch (e) {
  check("unexpected error", false, e instanceof Error ? e.message : String(e));
  await shot("zz-failure");
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
