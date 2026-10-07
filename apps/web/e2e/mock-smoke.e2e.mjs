/**
 * Smoke test of MOCK mode (the default: no API, demo data from shared fixtures), desktop and mobile.
 * Needs the web app built WITHOUT NEXT_PUBLIC_API_MODE (or with =mock) and running.
 * Run: E2E_WEB_URL=http://localhost:3112 pnpm --filter @project-name/web e2e:mock
 */
import { chromium } from "playwright-core";

const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + extra}`); };
const errors = [];

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ROUTES = ["/", "/connect", "/portfolio", "/tax", "/tax-reserve", "/give", "/launch", "/launch/configuration", "/launches", "/launches/view?id=00000000-0000-4000-8000-000000000801", "/launches/proof?id=00000000-0000-4000-8000-000000000801", "/launches/proof?id=00000000-0000-4000-8000-000000000801&scenario=SUPPLY_MISMATCH", "/launch/deployment?id=00000000-0000-4000-8000-000000000801", "/token/demo", "/discover", "/analytics", "/vaults", "/documents", "/trust"];

for (const [label, vp] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${label}: ${e}`));
  const main = async () => page.locator("main").innerText();
  const go = async (p) => { await page.goto(`${WEB}${p}`, { waitUntil: "networkidle" }); await page.waitForTimeout(350); };

  for (const r of ROUTES) {
    await go(r);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`${label} ${r} loads without horizontal overflow`, !overflow);
    check(`${label} ${r} labels demo data`, (await page.getByText("DEMO DATA").count()) > 0);
  }

  await go("/portfolio");
  let t = await main();
  check(`${label} portfolio (mock): populated, labeled demo`, t.includes("$34,235.00") && t.includes("DEMO DATA") && t.includes("belong to the demo account"));
  await page.locator("#wallet-picker").selectOption({ label: /Creator/ }).catch(async () => { const v = await page.locator("#wallet-picker option").nth(1).getAttribute("value"); await page.locator("#wallet-picker").selectOption(v); });
  await page.waitForTimeout(400);
  check(`${label} portfolio: switching wallet loads that wallet's holdings`, (await main()).includes("HRBR"));

  await go("/tax");
  t = await main();
  check(`${label} tax: estimated language, demo label, no tax bill`, t.includes("$18,420") && t.includes("Estimated tax exposure") && t.includes("DEMO DATA") && !/your tax bill/i.test(t));

  await go("/tax-reserve");
  check(`${label} reserve: ADD FUNDS / WITHDRAW disabled and funding is stated as not enabled`, (await page.getByRole("button", { name: "ADD FUNDS" }).isDisabled()) && (await page.getByRole("button", { name: "WITHDRAW" }).isDisabled()) && (await main()).includes("Reserve funding is not enabled in this beta."));
  t = await main();
  check(`${label} reserve: demo labels, estimate vs recommendation vs target vs balance are separate, balance is a labeled fixture`, t.includes("DEMO DATA") && t.includes("ESTIMATED RESERVE TARGET") && t.includes("DEMO RESERVE BALANCE") && t.includes("ESTIMATE · TAX DATA COMPLETE") && t.toLowerCase().includes("recommended reserve") && t.toLowerCase().includes("your reserve target"), t.slice(0, 900));
  check(`${label} reserve: no tax-liability or guarantee wording`, !/your tax (bill|liability)|guarantee|tax-free|you owe/i.test(t));
  await page.getByRole("button", { name: "EDIT RESERVE TARGET" }).click();
  await page.getByLabel("Percent of realized gains").fill("101");
  await page.getByRole("button", { name: "REVIEW TARGET" }).click();
  await page.getByRole("alert").getByText(/percent above 0/).waitFor({ timeout: 4000 });
  check(`${label} reserve: an invalid percent is refused before any confirmation`, !(await page.getByRole("alertdialog").count()));
  await page.getByLabel("Reserve target in USDC").waitFor({ timeout: 2000 }).catch(() => undefined);
  await page.getByRole("radio").first().check();
  await page.getByLabel("Reserve target in USDC").fill("NaN");
  await page.getByRole("button", { name: "REVIEW TARGET" }).click();
  await page.getByRole("alert").getByText(/digits only/).waitFor({ timeout: 4000 });
  check(`${label} reserve: NaN is refused`, !(await page.getByRole("alertdialog").count()));
  await page.getByRole("radio").nth(1).check();
  await page.getByLabel("Percent of realized gains").fill("25");
  await page.getByRole("button", { name: "REVIEW TARGET" }).click();
  await page.getByRole("alertdialog").waitFor({ timeout: 4000 });
  t = await main();
  check(`${label} reserve: saving needs an explicit confirmation that says no funds move`, t.includes("Save this reserve target?") && t.includes("25% of realized gains") && t.includes("It does not move or lock any funds") && !t.includes("Target saved."));
  await page.getByRole("button", { name: "CANCEL" }).click();
  check(`${label} reserve: cancel saves nothing`, !(await page.getByRole("alertdialog").count()) && !(await main()).includes("Target saved."));
  await page.getByRole("button", { name: "REVIEW TARGET" }).click();
  await page.getByRole("button", { name: "CONFIRM AND SAVE" }).click();
  await page.getByText("Target saved.").first().waitFor({ timeout: 4000 });
  check(`${label} reserve: valid target saved as a setting`, (await main()).includes("25% of realized gains"));

  await go("/give");
  t = await main();
  check(`${label} give: demo donation records are not presented as on-chain`, t.includes("DEMO RECORD · NOT ON-CHAIN") && !(await page.locator("table").first().innerText()).includes("CONFIRMED ON-CHAIN"));
  check(`${label} give: registry vocabulary, fixture verification labeled`, t.includes("CHARITY REGISTRY") && t.includes("VERIFIED (FIXTURE, NOT REAL-WORLD)") && ["verification source", "last reviewed"].every((l) => t.toLowerCase().includes(l)) && !/\bsafe\b|guarantee/i.test(t));
  check(`${label} give: demo receipt is labeled and is not a tax receipt`, t.includes("DEMO RECEIPT · NOT A TAX RECEIPT"));
  await page.getByRole("button", { name: "Details for donation to Open Water Initiative (demo)" }).first().click();
  await page.getByText("NOT A TAX RECEIPT", { exact: true }).first().waitFor({ timeout: 5000 });
  t = await main();
  check(`${label} give: donation detail shows fixture receipt labels and the deductibility caveat`, t.includes("DEMO RECEIPT") && t.includes("FIXTURE DATA") && t.includes("does not prove that a contribution is deductible") && t.includes("None. No transaction exists for this record."));
  await page.getByLabel("Amount (USDC)").fill("25");
  await page.getByRole("button", { name: "REVIEW DONATION" }).click();
  await page.getByText("REVIEW ONLY · NOTHING SENT").waitFor({ timeout: 5000 });
  check(`${label} give: review only, confirm is disabled, nothing is sent`, await page.getByRole("button", { name: "CONFIRM DONATION" }).isDisabled() && (await main()).includes("Donation transfers are not enabled in this beta."));

  await go("/discover");
  await page.getByRole("tab", { name: "Verified Transparency" }).click();
  await page.waitForTimeout(400);
  t = await main();
  check(`${label} discover: the Verified Transparency filter uses the server flag, so no demo token qualifies`, t.includes("NO TOKENS MATCH") && !t.includes("Orchard Demo") && !t.includes("VERIFIED TRANSPARENCY\n"));

  await go("/token/demo");
  t = await page.locator("body").innerText();
  check(`${label} proof: demo, not verified`, t.includes("BLOCKCHAIN VERIFICATION NOT YET CONNECTED") && !t.includes("VERIFIED TRANSPARENCY"));

  // status: DISCONNECTED -> CONNECTED · DEMO, never AUTHENTICATED in mock mode
  await go("/launch");
  const header = () => page.locator("header").first().innerText();
  if (label === "mobile") await page.getByRole("button", { name: "Open navigation" }).click();
  if (label === "mobile") { check("mobile: navigation drawer opens", await page.getByRole("navigation", { name: "Primary" }).isVisible()); await page.getByRole("button", { name: "Close navigation" }).click({ position: { x: 360, y: 400 } }); }
  check(`${label} status starts DISCONNECTED`, (await header()).includes("DISCONNECTED"));
  await page.getByRole("button", { name: "CONNECT WALLET" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /Phantom/ }).click();
  await page.waitForTimeout(300);
  const h = await header();
  check(`${label} mock connection is CONNECTED · DEMO and never AUTHENTICATED`, h.includes("CONNECTED") && !h.includes("AUTHENTICATED"));

  const next = () => page.getByRole("button", { name: "CONTINUE", exact: true }).click();
  for (let i = 0; i < 2; i++) await next();
  await page.locator("#t-name").fill("Mock Token");
  await page.locator("#t-symbol").fill("MOCK");
  for (let i = 0; i < 6; i++) await next();
  await page.getByRole("button", { name: "SAVE DRAFT" }).click();
  await page.getByText("NOT DEPLOYED").first().waitFor({ timeout: 5000 });
  check(`${label} launch (mock): saved as a DRAFT, NOT DEPLOYED, NOT VERIFIED ON-CHAIN, DEMO DATA`, (await main()).includes("NOT VERIFIED ON-CHAIN") && (await main()).includes("DEMO DATA") && (await main()).includes("Not validated yet."));
  await page.getByRole("button", { name: "VALIDATE CONFIGURATION" }).click();
  await page.getByText("Server validation passed this configuration.").first().waitFor({ timeout: 5000 });
  check(`${label} launch (mock): validated; the fixture charity is labeled and nothing is deployed`, (await main()).includes("VERIFIED (FIXTURE, NOT REAL-WORLD)") && (await main()).includes("Deployable: no"));
  await page.getByRole("button", { name: "SUBMIT FOR REVIEW" }).click();
  await page.getByRole("button", { name: "MARK READY FOR DEPLOYMENT" }).waitFor({ timeout: 5000 });
  check(`${label} launch (mock): READY needs confirmation`, await page.getByRole("button", { name: "MARK READY FOR DEPLOYMENT" }).isDisabled());
  await page.getByLabel(/I have reviewed this exact configuration/).check();
  await page.getByLabel(/Make this configuration publicly viewable/).check();
  await page.getByRole("button", { name: "MARK READY FOR DEPLOYMENT" }).click();
  await page.getByText("Configuration validated.").first().waitFor({ timeout: 5000 });
  t = await main();
  check(`${label} launch (mock): READY FOR DEPLOYMENT, not deployed, deployment not enabled`, t.includes("READY FOR DEPLOYMENT") && t.includes("On-chain deployment is not enabled in this beta.") && t.includes("No on-chain transaction has been submitted") && !/\bLIVE\b/.test(t));
  if (label === "desktop") {
    await page.getByRole("link", { name: "PUBLIC CONFIGURATIONS" }).first().click();
    await page.waitForURL(/\/launches$/, { timeout: 5000 });
    await page.getByText("Published configurations").first().waitFor({ timeout: 5000 });
    await page.getByText("VIEW CONFIGURATION").first().waitFor({ timeout: 5000 });
    t = await main();
    check(`${label} public launches (mock): the published one and the demo one, both labeled`, ["mock token", "harbor demo launch", "demo data", "not deployed", "not verified on-chain"].every((x) => t.toLowerCase().includes(x)), t.slice(0, 600));
  }
  await go("/launches/view?id=00000000-0000-4000-8000-000000000801");
  await page.getByText("Configured allocations").first().waitFor({ timeout: 5000 });
  t = await main();
  check(`${label} demo launch view: DEMO DATA, NOT DEPLOYED, NOT VERIFIED ON-CHAIN, user-provided metadata, fingerprint`, ["demo data", "not deployed", "not verified on-chain", "user-provided", "configuration fingerprint", "it is not a blockchain proof."].every((x) => t.toLowerCase().includes(x)), t.slice(0, 600));
  await go("/launches/proof?id=00000000-0000-4000-8000-000000000801");
  await page.getByText("A · IDENTITY").first().waitFor({ timeout: 8000 });
  t = await main();
  check(`${label} demo token proof: PARTIAL PROOF, labeled DEMO / FIXTURE / NOT VERIFIED ON-CHAIN, never Verified Transparency`, t.includes("PARTIAL PROOF") && t.includes("DEMO · FIXTURE · NOT VERIFIED ON-CHAIN") && t.includes("IN PLAIN WORDS") && t.includes("FIXTURE SCENARIO") && !/VERIFIED TRANSPARENCY(?! is shown only)/.test(t), t.slice(0, 800));
  await page.getByRole("button", { name: /SUPPLY MISMATCH/ }).click();
  await page.waitForURL(/scenario=SUPPLY_MISMATCH/, { timeout: 5000 });
  await page.getByText("VERIFICATION FAILED").first().waitFor({ timeout: 5000 });
  t = await main();
  check(`${label} demo token proof: a supply mismatch shows VERIFICATION FAILED with configured vs observed values`, t.includes("VERIFICATION FAILED") && t.includes("1,000,000,000,000,000") && t.includes("1000000000000001"));
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(`${label} token proof: no horizontal overflow`, noScroll);
  await go("/launch/deployment?id=00000000-0000-4000-8000-000000000801");
  await page.getByText("1 · TOKEN").first().waitFor({ timeout: 8000 });
  t = await main();
  check(`${label} demo deployment plan: PLAN BLOCKED, DEMO · FIXTURE, NOT DEPLOYED / NOT SIGNED / NO FUNDS MOVED, disabled execution, no deploy control`, ["PLAN BLOCKED", "DEMO · FIXTURE", "NOT DEPLOYED", "NOT SIGNED", "NO FUNDS MOVED", "EXECUTION NOT ENABLED IN THIS BETA", "DECISIONS REQUIRED", "LIQUIDITY_BUILD_NOT_IMPLEMENTED", "9 · WHAT THE WALLET WILL NEED TO SIGN"].every((x) => t.includes(x)) && !/DEPLOY NOW|SIGN NOW|DEPLOYED SUCCESSFULLY|READY FOR USER REVIEW/.test(t) && (await page.locator("main button:not([disabled])").filter({ hasText: /deploy|sign|send|execute/i }).count()) === 0, t.slice(0, 700));
  check(`${label} deployment plan: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await ctx.close();
}
await browser.close();
const real = errors.filter((e) => !/Failed to load resource/.test(e));
check("no console errors", real.length === 0, real.join(" | "));
const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
