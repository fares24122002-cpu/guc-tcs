const { chromium, devices } = require("playwright");
const fs = require("fs");
const WEB = "http://localhost:4173", API = "http://localhost:4100/api";
const PHOTOS = [0, 1, 2, 3, 4, 5].map((i) => `/tmp/e2e-photos/p${i}.jpg`);
const OUT = process.env.E2E_SHOTS || "/tmp/e2e-shots";
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiLogin(u) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: "e2e-password-123" }) });
  return (await r.json()).session.access_token;
}
async function ui_login(page, u) {
  await page.goto(WEB);
  await page.getByLabel("Username").fill(u);
  await page.getByLabel("Password").fill("e2e-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, tag) => {
    page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${tag} console: ${m.text()}`); });
  };

  // ---- staff on a phone ------------------------------------------------------------------
  const phone = await browser.newContext({ ...devices["Pixel 5"] });
  const sp = await phone.newPage(); watch(sp, "staff");
  await ui_login(sp, "anna");
  await sp.waitForURL("**/register");
  await sp.screenshot({ path: `${OUT}/01-register-mobile.png` });
  let uploadBytes = 0;
  sp.on("requestfinished", async (r) => { if (r.method() === "POST" && r.url().endsWith("/registrations") && !uploadBytes) uploadBytes = (await r.sizes()).requestBodySize; });
  await sp.locator('input[type=file]:not([capture])').setInputFiles(PHOTOS[0]);
  await sp.getByText(/Compressed to \d+ KB/).waitFor();
  const kb = Number((await sp.getByText(/Compressed to \d+ KB/).textContent()).match(/(\d+) KB/)[1]);
  check(kb <= 520, `4 MB camera photo compressed in the browser to ${kb} KB`);
  await sp.getByLabel("Full name").fill("Mariam El Sayed");
  const regBtn = sp.getByRole("button", { name: "Register", exact: true });
  check(await regBtn.isDisabled(), "Register button disabled until consent is given");
  await sp.getByRole("checkbox").check();
  await regBtn.click();
  await sp.getByText(/^TCS-\d{5}$/).waitFor();
  const sys = await (await fetch(`${API}/admin/system`, { headers: { Authorization: `Bearer ${await apiLogin("boss")}` } })).json();
  check(sys.storage.objects === 1 && sys.storage.bytes < 700 * 1024, `stored photo is ${Math.round(sys.storage.bytes / 1024)} KB (from a ~4160 KB original)`);
  await sp.screenshot({ path: `${OUT}/02-registered-mobile.png` });
  await sp.getByRole("button", { name: "Register next person" }).click();

  // duplicate warning
  await sp.locator('input[type=file]:not([capture])').setInputFiles(PHOTOS[1]);
  await sp.getByText(/Compressed to/).waitFor();
  await sp.getByLabel("Full name").fill("mariam  el sayed");
  await sp.getByRole("checkbox").check();
  await sp.getByRole("button", { name: "Register", exact: true }).click();
  await sp.getByText(/is already registered/).waitFor();
  check(true, "same-name registration shows a duplicate warning instead of saving");
  await sp.screenshot({ path: `${OUT}/03-duplicate-warning.png` });
  await sp.getByRole("button", { name: "Different person, register" }).click();
  await sp.getByText(/^TCS-\d{5}$/).waitFor();
  check(true, "confirmed different person is registered");

  // staff cannot reach admin pages
  await sp.goto(`${WEB}/giveaway`);
  await sp.waitForURL("**/register");
  check(true, "staff opening /giveaway is redirected to /register");
  await sp.goto(`${WEB}/registrations`);
  await sp.getByText("Mariam El Sayed").first().waitFor();
  await sp.screenshot({ path: `${OUT}/04-my-registrations.png` });

  // ---- seed more people through the API --------------------------------------------------
  const staffTok = await apiLogin("anna");
  const names = ["Omar Khaled", "Nour Ahmed", "Youssef Tarek", "Laila Hassan", "Karim Adel", "Salma Ibrahim", "Hana Mostafa", "Ziad Fathy", "Dina Samir", "Farida Nabil"];
  for (let i = 0; i < names.length; i++) {
    const fd = new FormData();
    fd.set("full_name", names[i]); fd.set("consent", "true");
    const days = await (await fetch(`${API}/event-days`, { headers: { Authorization: `Bearer ${staffTok}` } })).json();
    fd.set("event_day_id", days.days[0].id); fd.set("idempotency_key", crypto.randomUUID());
    fd.set("photo", new Blob([fs.readFileSync(PHOTOS[i % 6])], { type: "image/jpeg" }), "p.jpg");
    const r = await fetch(`${API}/registrations`, { method: "POST", headers: { Authorization: `Bearer ${staffTok}` }, body: fd });
    if (r.status !== 201) { check(false, `seed ${names[i]} -> ${r.status}`); }
  }

  // ---- admin on a desktop ----------------------------------------------------------------
  const desk = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const ap = await desk.newPage(); watch(ap, "admin");
  await ui_login(ap, "boss");
  await ap.getByRole("heading", { name: "Dashboard" }).waitFor();
  await ap.screenshot({ path: `${OUT}/05-dashboard.png` });
  await ap.goto(`${WEB}/duplicates`);
  await ap.getByRole("button", { name: "Different people" }).first().click();
  await ap.getByText("Nothing here.").waitFor();
  check(true, "admin reviewed the duplicate");
  await ap.screenshot({ path: `${OUT}/06-duplicates.png` });
  await ap.goto(`${WEB}/giveaway`);
  await ap.getByRole("heading", { name: "Giveaway controller" }).waitFor();
  await ap.locator("select").first().selectOption("daily");
  await ap.waitForTimeout(500);
  await ap.screenshot({ path: `${OUT}/07-giveaway.png` });
  for (const p of ["/event-days", "/staff", "/winners", "/photos", "/reports", "/activity", "/system"]) {
    await ap.goto(`${WEB}${p}`); await ap.waitForLoadState("networkidle");
    await ap.screenshot({ path: `${OUT}/page${p.replace("/", "-")}.png` });
  }

  // ---- projector -------------------------------------------------------------------------
  const pp = await desk.newPage(); watch(pp, "projector");
  await pp.goto(`${WEB}/present`);
  await pp.getByRole("button", { name: "SHUFFLE" }).waitFor();
  await pp.screenshot({ path: `${OUT}/10-stage1.png` });
  const t0 = Date.now();
  await pp.getByRole("button", { name: "SHUFFLE" }).click();
  await pp.getByText("Shuffling", { exact: true }).waitFor();
  const tStart = Date.now();
  await sleep(1500);
  const countAt = async () => Number((await pp.locator("span.font-display").first().textContent()) || -1);
  const c1 = await countAt();
  await sleep(500);
  await pp.screenshot({ path: `${OUT}/11-stage2.png` });
  check(c1 >= 12 && c1 <= 14, `countdown shows ${c1} about 1.5 s in`);
  // watch for the winners and record how many appear on the first frame they do
  let firstSeen = 0, tReveal = 0;
  const seen = [];
  for (let i = 0; i < 400; i++) {
    const n = await pp.locator("ol > li").count();
    if (n > 0) { firstSeen = n; tReveal = Date.now(); break; }
    seen.push(await countAt().catch(() => -1));
    await sleep(100);
  }
  const elapsed = (tReveal - tStart) / 1000;
  check(firstSeen === 5, `all 5 winners appeared in the same moment (${firstSeen})`);
  check(elapsed >= 13 && elapsed <= 16.5, `reveal came ${elapsed.toFixed(1)} s after the shuffle started`);
  check(seen.includes(1) && Math.min(...seen.filter((x) => x >= 0)) <= 1, "countdown reached the final seconds");
  await sleep(1500);
  await pp.screenshot({ path: `${OUT}/12-stage3.png` });
  await sleep(7000);
  await pp.screenshot({ path: `${OUT}/13-stage3-calm.png` });
  const winnerNames = await pp.locator("ol > li p.font-display").allTextContents();
  check(new Set(winnerNames).size === 5, `five different winners: ${winnerNames.join(", ")}`);
  check(await pp.getByText("CONGRATULATIONS!").isVisible(), "CONGRATULATIONS! is visible");
  // row layout: all cards share the same vertical position
  const tops = await pp.locator("ol > li").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  check(new Set(tops).size === 1, "winners sit in a single horizontal row");

  // reload keeps the revealed state and never redraws
  await pp.reload();
  await pp.locator("ol > li").first().waitFor();
  const again = await pp.locator("ol > li p.font-display").allTextContents();
  check(JSON.stringify(again) === JSON.stringify(winnerNames), "reloading the projector shows the same winners");

  // ---- read-only projector link ----------------------------------------------------------
  const adminTok = await apiLogin("boss");
  const tok = (await (await fetch(`${API}/presentation/projector-token`, { method: "POST", headers: { Authorization: `Bearer ${adminTok}`, "Content-Type": "application/json" }, body: "{}" })).json()).token;
  const ro = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const rp = await ro.newPage(); watch(rp, "readonly");
  await rp.goto(`${WEB}/present?t=${tok}`);
  await rp.locator("ol > li").first().waitFor();
  check((await rp.locator("ol > li").count()) === 5, "read-only link shows the winners (reduced motion)");
  check((await rp.getByRole("button", { name: "SHUFFLE" }).count()) === 0, "read-only link has no SHUFFLE button");
  await rp.screenshot({ path: `${OUT}/14-readonly-reduced.png` });
  const bad = await ro.newPage();
  await bad.goto(`${WEB}/present?t=garbage`);
  await bad.getByText(/expired/i).waitFor();
  check(true, "a bad projector link is refused");

  // replay from the controller
  await fetch(`${API}/presentation/replay`, { method: "POST", headers: { Authorization: `Bearer ${adminTok}`, "Content-Type": "application/json" }, body: "{}" });
  await rp.getByText("Shuffling", { exact: true }).waitFor({ timeout: 5000 });
  check(true, "replay from the controller restarts the countdown on the read-only screen");

  const real = errors.filter((e) => !/Failed to load resource.*(401|404|409|ERR_TUNNEL)/.test(e));
  check(real.length === 0, `no browser console errors${real.length ? ": " + real.slice(0, 3).join(" | ") : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL E2E CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
