/**
 * End-to-end check of the real stack in a browser (API mode): wallet sign-in, every screen, logout.
 *
 * Needs: API on :4000 (database migrated AND seeded with `pnpm db:seed-demo` so the demo charities exist)
 *        and web on :3000 built with NEXT_PUBLIC_API_MODE=api (see docs/ENVIRONMENT.md).
 * Slice 5 checks also need a FAKE Solana RPC (never a real one): `pnpm --filter @project-name/api fake:rpc` on :8899, and the API started with
 *        SOLANA_RPC_URL=http://127.0.0.1:8899 SOLANA_CLUSTER=devnet INDEXER_MIN_SYNC_INTERVAL_SECONDS=2 INDEXER_SYNC_ON_LOGIN=false
 *        and RATE_LIMIT_MAX / RATE_LIMIT_WRITE_MAX / INDEXER_SYNC_RATE_LIMIT_MAX raised (back-to-back runs otherwise hit the limiter).
 * Run:   pnpm --filter @project-name/web e2e:api
 *
 * A fake Wallet Standard wallet named "Phantom" is injected into the page. Its signMessage calls back into
 * this Node process, which signs with a REAL ed25519 key generated here for this run only (ephemeral, in
 * memory, never written anywhere). The app under test never sees a private key.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { chromium } from "playwright-core";

const WEB = process.env.E2E_WEB_URL ?? "http://localhost:3000";
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const SHOTS = process.env.E2E_SHOTS_DIR;

// ---- ephemeral test wallet ----
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const rawPub = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex")), out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out;
}
const ADDRESS = base58(rawPub);

const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + extra}`); };

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

let signCalls = 0, signedMessages = [];
await page.exposeFunction("__nodeSign", (bytes) => {
  signCalls += 1;
  signedMessages.push(Buffer.from(bytes).toString("utf8"));
  return Array.from(sign(null, Buffer.from(bytes), privateKey));
});

await page.addInitScript((address) => {
  const pub = new Uint8Array(32); // contents irrelevant to the app; it uses the address string
  const account = { address, publicKey: pub, chains: ["solana:devnet"], features: ["solana:signMessage"] };
  window.__rejectNext = false;
  const wallet = {
    version: "1.0.0", name: "Phantom", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
    chains: ["solana:devnet", "solana:mainnet"], accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async ({ message }) => {
          if (window.__rejectNext) { window.__rejectNext = false; const e = new Error("User rejected the request."); e.code = 4001; throw e; }
          const sig = await window.__nodeSign(Array.from(message));
          return [{ signedMessage: message, signature: new Uint8Array(sig) }];
        },
      },
    },
  };
  const register = (api) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}, ADDRESS);

const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const apiGet = (path) => context.request.get(`${API}${path}`);

// 0. Unauthenticated
await page.goto(WEB, { waitUntil: "networkidle" });
check("protected API call without a session is 401", (await apiGet("/api/wallets")).status() === 401);
check("topbar offers CONNECT WALLET and says DISCONNECTED", (await page.getByRole("button", { name: "CONNECT WALLET" }).count()) > 0 && (await page.locator("header").first().innerText()).includes("DISCONNECTED"));

// 1. Connect (NOT authenticated)
await page.getByRole("button", { name: "CONNECT WALLET" }).first().click();
await page.getByRole("dialog").waitFor();
check("modal lists Phantom as Detected", (await page.getByRole("dialog").getByText("Detected", { exact: true }).count()) === 1);
check("Solflare/Backpack shown as not detected with install links", (await page.getByRole("dialog").getByText("Not detected in this browser").count()) === 2);
await shot("1-choose-wallet");
await page.getByRole("dialog").getByRole("button", { name: /CONNECT/ }).first().click();
await page.getByRole("dialog").getByText("Not authenticated yet").waitFor();
check("after connect: CONNECTED badge, not authenticated", (await page.getByRole("dialog").getByText("CONNECTED", { exact: true }).count()) === 1 && (await page.getByRole("dialog").getByText("AUTHENTICATED", { exact: true }).count()) === 0);
check("explicit signing explanation is shown", (await page.getByRole("dialog").getByText("Sign this message to securely authenticate with PROJECT_NAME. This does not send a transaction or move funds.").count()) === 1);
check("topbar shows CONNECTED (not AUTHENTICATED) after connect", (await page.locator("header").first().innerText()).includes("CONNECTED") && !(await page.locator("header").first().innerText()).includes("AUTHENTICATED"));
check("connection alone does not create a session", (await apiGet("/api/wallets")).status() === 401);
check("no signature requested yet", signCalls === 0);
await shot("2-connected-not-authenticated");

// 2. Wallet declines: still connected, not authenticated, clear message
await page.evaluate(() => { window.__rejectNext = true; });
await page.getByRole("button", { name: "SIGN MESSAGE" }).click();
await page.getByRole("alert").getByText(/declined in your wallet/i).waitFor();
check("declined signature shows a clear error and does not authenticate", (await apiGet("/api/wallets")).status() === 401);

// 3. Sign for real
await page.getByRole("button", { name: "SIGN MESSAGE" }).click();
await page.getByRole("dialog").waitFor({ state: "detached", timeout: 10000 });
check("wallet was asked to sign exactly once for the successful attempt", signCalls === 1);
const msg = signedMessages[0] ?? "";
check("signed text is the sign-in message for this wallet", msg.includes(ADDRESS) && msg.includes("Sign in to PROJECT_NAME. This does not send a transaction or move funds.") && /Nonce: [A-Za-z0-9_-]{32}\n/.test(msg) && msg.includes("localhost:3000 wants you to sign in"));
check("topbar now shows AUTHENTICATED", (await page.getByText("AUTHENTICATED", { exact: true }).count()) > 0);
await shot("3-authenticated");

// 4. Session cookie properties; no secrets in page-visible storage
const cookies = await context.cookies(API);
const sc = cookies.find((c) => c.name === "pn_session");
check("session cookie exists, HttpOnly, SameSite=Strict, Path=/", !!sc && sc.httpOnly === true && sc.sameSite === "Strict" && sc.path === "/", JSON.stringify(sc));
const visible = await page.evaluate(() => ({ cookie: document.cookie, ls: JSON.stringify({ ...localStorage }), ss: JSON.stringify({ ...sessionStorage }) }));
check("session secret is not readable by page scripts or stored in web storage", !!sc && !visible.cookie.includes(sc.value) && !visible.ls.includes(sc.value) && !visible.ss.includes(sc.value) && !visible.ls.includes("pn_session"));
const me = await apiGet("/api/auth/session");
const meBody = await me.json();
check("API reports authenticated wallet and never returns the token", meBody.authenticated === true && meBody.wallet?.address === ADDRESS && meBody.wallet?.ownershipVerified === true && !JSON.stringify(meBody).includes(sc?.value ?? "@@"));
check("protected API call now succeeds with the cookie", (await apiGet("/api/wallets")).status() === 200);

// 4b. Screens, as an authenticated REAL wallet
const text = async () => (await page.locator("main").innerText());
const go = async (path) => { await page.goto(`${WEB}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(400); };

await go("/portfolio");
let t = await text();
check("portfolio: authenticated wallet with no indexed data gets the empty state and a SYNC WALLET button", t.includes("NO LIVE PORTFOLIO DATA YET") && t.includes("Press SYNC WALLET") && (await page.getByRole("button", { name: "SYNC WALLET" }).count()) === 1);
check("portfolio: no demo balances are attached to the real wallet", !/DEMO DATA|\$34,235|\$42,810|BONK|JUP/.test(t), t.slice(0, 300));
check("portfolio: transactions empty state, nothing invented", t.includes("NO LIVE TRANSACTIONS YET") && !t.includes("DEMO-SIG"));
await shot("5-portfolio-empty");

// ---- Slice 5: read-only indexing against the fake RPC (see apps/api/scripts/fake-rpc-server.ts) ----
const RPC = process.env.E2E_FAKE_RPC_URL ?? "http://127.0.0.1:8899";
const rpcStats = async () => (await fetch(`${RPC}/__control/stats`)).json();
const walletsBody = await (await apiGet("/api/wallets")).json();
const WALLET_ID = walletsBody.wallets[0].id;
const pre = await (await apiGet(`/api/wallets/${WALLET_ID}/sync`)).json();
check("sync status before syncing: never_synced, read-only limits exposed, no RPC URL", pre.state === "never_synced" && pre.configured === true && !JSON.stringify(pre).includes("8899"));
await page.getByRole("button", { name: "SYNC WALLET" }).click();
await page.getByRole("button", { name: "REFRESH DATA" }).waitFor({ timeout: 15000 });
await page.getByText("Holdings").first().waitFor({ timeout: 5000 });
t = await text();
await shot("5b-portfolio-live");
check("live portfolio is labeled LIVE DATA, not DEMO", t.includes("LIVE DATA") && !t.includes("DEMO DATA") && !/BONK|JUP|\$34,235/.test(t));
check("SOL balance comes from the node (3.5 SOL)", /\b3\.5\b/.test(t));
check("no price source configured: PRICE DATA UNAVAILABLE and no fabricated USD value", t.includes("PRICE DATA UNAVAILABLE") && t.includes("PRICE UNAVAILABLE") && !t.includes("$0.00"));
check("SPL token is shown by mint with UNVERIFIED METADATA; hostile markup is inert text", t.includes("UNVERIFIED METADATA") && t.includes("<b>E2E Coin</b>") && (await page.locator("main b").count()) === 0);
check("transactions: 3 indexed, FAILED status, NOT ASSESSED tax, no DEMO-SIG", t.includes("3 indexed") && t.includes("FAILED") && t.includes("NOT ASSESSED") && !t.includes("DEMO-SIG"));
const link = await page.locator('main a[href^="https://explorer.solana.com/tx/"]').first().getAttribute("href");
check("signature links to the explorer for the right cluster", !!link && link.endsWith("?cluster=devnet"));
check("no tax conclusion language on live portfolio", !/your tax bill|taxable gain|you owe/i.test(t));
const apiPortfolio = await (await apiGet(`/api/portfolio/${WALLET_ID}`)).json();
check("API portfolio: chain data, unverified, partial/total never fabricated", apiPortfolio.dataSource === "chain" && apiPortfolio.verifiedOnChain === false && apiPortfolio.totalValueCents === null && apiPortfolio.assets.every((a) => a.valueCents === null && a.valuation === "price_unavailable"));
check("API never exposes the RPC URL", !JSON.stringify(apiPortfolio).includes("127.0.0.1:8899"));

// Idempotent repeat sync: nothing is refetched or duplicated
const before = await rpcStats();
await page.waitForTimeout(2500); // per-wallet cooldown (2s in this run)
await page.getByRole("button", { name: "REFRESH DATA" }).click();
await page.waitForTimeout(2500);
const after = await rpcStats();
const txList = await (await apiGet(`/api/transactions/${WALLET_ID}`)).json();
check("repeat sync does not refetch known transactions and creates no duplicates", (after.getTransaction ?? 0) === (before.getTransaction ?? 0) && txList.pagination.total === 3 && new Set(txList.transactions.map((x) => x.signature)).size === 3, JSON.stringify({ before, after }));

// New transaction appears after REFRESH DATA
await fetch(`${RPC}/__control/new-tx?address=${ADDRESS}`, { method: "POST" });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "REFRESH DATA" }).click();
await page.getByText("4 indexed").first().waitFor({ timeout: 15000 });
const after2 = await rpcStats();
check("refresh fetches only the one new transaction", after2.getTransaction === (before.getTransaction ?? 0) + 1, JSON.stringify(after2));

// Cooldown surfaces as a friendly message (no crash)
const cool = await context.request.post(`${API}/api/wallets/${WALLET_ID}/sync`, { headers: { origin: WEB } });
check("sync inside the cooldown is 429 SYNC_COOLDOWN", cool.status() === 429 && (await cool.json()).error.code === "SYNC_COOLDOWN");

await go("/tax");
t = await text();
check("tax: real wallet shows a LIVE (unverified) estimate with status PARTIAL, never demo numbers", t.includes("LIVE DATA (UNVERIFIED)") && t.includes("PARTIAL") && t.includes("Tax data incomplete") && !t.includes("$18,420") && !/DEMO DATA/.test(t), t.slice(0, 400));
check("tax: accounting method is explicit (FIFO default) and swaps are labeled an assumption", t.includes("FIFO (DEFAULT)") && t.includes("not a legal conclusion"));
check("tax: unresolved transfers listed, no exposure without user rates, no purchases invented", t.includes("UNRESOLVED TRANSFERS") && t.includes("RATES REQUIRED") && !t.includes("Acquisition (buy)"));
check("tax: no tax-bill / guarantee wording", !/your tax bill|guaranteed|loophole|tax-free/i.test(t));
const taxApi = await (await apiGet(`/api/tax/${WALLET_ID}`)).json();
check("tax API: chain data, unverified, not complete, fingerprint present", taxApi.dataSource === "chain" && taxApi.verifiedOnChain === false && taxApi.figuresComplete === false && taxApi.status !== "COMPLETE" && /^[0-9a-f]{64}$/.test(taxApi.calculation.inputFingerprint));
await page.getByRole("tab", { name: /All \(/ }).click();
t = await text();
check("tax: event list shows the failed transaction as a network fee and the received token as an unresolved transfer", t.includes("Network fee") && t.includes("Transfer in") && t.includes("UNRESOLVED"));
await page.locator("form").filter({ has: page.getByRole("button", { name: "RECALCULATE" }) }).locator("select").first().selectOption("HIFO");
await page.getByRole("button", { name: "RECALCULATE" }).click();
await page.locator('section[aria-label="Calculation status"] span').filter({ hasText: /^HIFO/ }).first().waitFor({ timeout: 8000 });
check("tax: choosing HIFO is applied and echoed (no longer 'default')", !(await text()).includes("HIFO (DEFAULT)"));
await shot("5c-tax-live");

// ---- Slice 7: USER_PROVIDED cost basis ----
t = await text();
check("cost basis: COST BASIS REQUIRED with the no-verified-basis wording, USER-PROVIDED label, and both buttons", t.includes("COST BASIS REQUIRED") && t.includes("This asset has no verified historical cost basis.") && t.includes("USER-PROVIDED TAX DATA") && t.includes("REVIEW EXISTING BASIS") && !/verified on-chain/i.test(t));
const addFor = async (needle, date, cost, notes) => {
  await page.locator("li", { hasText: needle }).getByRole("button", { name: "ADD COST BASIS" }).first().click();
  await page.getByLabel(/Acquisition date and time/).fill(date);
  await page.getByLabel(/Total cost basis/).fill(cost);
  if (notes) await page.getByLabel(/Notes \(optional/).fill(notes);
  await page.getByRole("button", { name: "SAVE COST BASIS" }).click();
};
// 1. token received: prefilled from the transfer (asset, decimals, quantity, signature)
await page.locator("li", { hasText: "1.5" }).getByRole("button", { name: "ADD COST BASIS" }).first().click();
check("cost basis form is prefilled from the unresolved transfer (quantity, decimals, signature) and labeled USER-PROVIDED", (await page.getByLabel(/Quantity \(whole tokens\)/).inputValue()) === "1.5" && (await page.getByLabel(/Token decimals/).inputValue()) === "6" && (await page.getByLabel(/Transaction signature/).inputValue()).length > 60);
await page.getByLabel(/Acquisition date and time/).fill("2099-01-01T00:00:00Z");
await page.getByLabel(/Total cost basis/).fill("75.005");
await page.getByRole("button", { name: "SAVE COST BASIS" }).click();
t = await text();
check("invalid input is rejected with field messages and nothing is saved", /in the future/.test(t) && /at most 2 decimals/.test(t) && (await (await apiGet(`/api/wallets/${WALLET_ID}/manual-basis`)).json()).records.length === 0);
await page.getByLabel(/Acquisition date and time/).fill("2024-01-01T00:00:00Z");
await page.getByLabel(/Total cost basis/).fill("75.00");
await page.getByRole("button", { name: "SAVE COST BASIS" }).click();
await page.getByText(/Saved as revision 1/).waitFor({ timeout: 8000 });
await page.getByText("$75.00 USD").first().waitFor({ timeout: 8000 });
t = await text();
check("after saving: saved notice names USER_PROVIDED and says it is not verified on-chain; the record is listed with the provenance label", t.includes("USER_PROVIDED") && /not verified on-chain/.test(t) && t.includes("$75.00 USD"));
// 2. SOL received: second basis, with hostile notes
await page.getByRole("button", { name: /^ADD COST BASIS/ }).first().waitFor({ timeout: 8000 });
await addFor("Received, origin unknown", "2024-01-01T00:00:00Z", "100.00", "<img src=x onerror=window.__xss=1> bought on an exchange");
await page.getByText(/Saved as revision 1/).waitFor({ timeout: 8000 });
// the earlier "refresh" step added a second (0.1 SOL) incoming transfer: give it basis too
await page.getByRole("button", { name: /^ADD COST BASIS/ }).first().waitFor({ timeout: 8000 });
await addFor("Received, origin unknown", "2024-01-02T00:00:00Z", "10.00");
await page.getByText(/Saved as revision 1/).waitFor({ timeout: 8000 });
await page.getByText("COMPLETE (ESTIMATE)").first().waitFor({ timeout: 10000 });
t = await text();
check("with basis for every transfer the status becomes COMPLETE (an estimate), only because the Slice 6 completeness rules are met", t.includes("COMPLETE (ESTIMATE)") && !t.includes("COST BASIS REQUIRED"));
check("notes are rendered as inert text (no element created, no script ran)", (await page.locator("main img").count()) === 0 && (await page.evaluate(() => window.__xss)) === undefined && t.includes("<img src=x onerror=window.__xss=1>"));
const apiList = await (await apiGet(`/api/wallets/${WALLET_ID}/manual-basis`)).json();
check("API: records are USER_PROVIDED, verifiedOnChain false, exact raw quantities", apiList.records.length === 3 && apiList.records.every((r) => r.source === "USER_PROVIDED" && r.verifiedOnChain === false) && apiList.records.some((r) => r.quantityRaw === "1500000"));
// 3. audit history
await page.getByRole("button", { name: "AUDIT HISTORY", exact: true }).first().click();
await page.getByText("Hash chain intact").waitFor({ timeout: 5000 });
check("audit history shows revisions and an intact hash chain", /Earlier values are never overwritten/.test(await text()));
// 4. duplicate: add the token basis again
await page.getByRole("button", { name: /^ADD COST BASIS/ }).first().click();
await page.getByLabel(/^Asset/).fill(apiList.records.find((r) => r.mint)?.mint ?? "");
await page.getByLabel(/Token decimals/).fill("6");
await page.getByLabel(/Quantity \(whole tokens\)/).fill("1.5");
await page.getByLabel(/Acquisition date and time/).fill("2024-01-01T06:00:00Z");
await page.getByLabel(/Total cost basis/).fill("75.00");
await page.getByRole("button", { name: "SAVE COST BASIS" }).click();
await page.getByText(/Review needed: POTENTIAL DUPLICATE/).waitFor({ timeout: 8000 });
await page.getByText("PARTIAL", { exact: true }).first().waitFor({ timeout: 10000 });
t = await text();
check("duplicate basis is flagged, EXCLUDED from the calculation, explained, and the status drops from COMPLETE (never double counted)", /POTENTIAL DUPLICATE/.test(t) && /Excluded from the calculation until reviewed/.test(t) && /counted twice/.test(t) && !t.includes("COMPLETE (ESTIMATE)"));
// 5. void the duplicate (soft, audited)
page.once("dialog", (d) => d.accept("duplicate entry"));
await page.locator("li", { hasText: "POTENTIAL DUPLICATE" }).getByRole("button", { name: "VOID" }).first().click();
await page.getByText("VOIDED").first().waitFor({ timeout: 8000 });
await page.getByText("COMPLETE (ESTIMATE)").first().waitFor({ timeout: 10000 });
const all = await (await apiGet(`/api/wallets/${WALLET_ID}/manual-basis?includeVoided=true`)).json();
check("void keeps the record (no hard delete) and the status returns to COMPLETE", all.records.length === 4 && all.records.filter((r) => r.status === "voided").length === 1);
// ---- Slice 8: TAX REPORT and export ----
const rpt = page.locator('section[aria-label="Tax report"]');
await rpt.getByText("COMPLETE (ESTIMATE)").waitFor({ timeout: 10000 });
t = await rpt.innerText();
check("tax report: estimated report, status COMPLETE (ESTIMATE), explicit UTC calendar-year boundary, summary cards", /TAX REPORT/i.test(t) && t.includes("Estimated tax report") && t.includes("UTC, by disposal time") && /Realized proceeds/i.test(t) && /Net gain \/ loss/i.test(t) && /Unresolved/i.test(t));
check("tax report: states 'Includes user-provided tax data.', lists the records, fixture/unverified wording, no banned claims", t.includes("Includes user-provided tax data.") && /USER-PROVIDED/.test(t) && /not independently verified/.test(t) && !/irs-ready|tax filing ready|guaranteed|verified tax return|your tax bill/i.test(t));
await rpt.locator("select").nth(0).selectOption("HIFO");
await rpt.getByRole("button", { name: "UPDATE REPORT" }).click();
await rpt.locator('section[aria-label="Report status"] span', { hasText: /^HIFO$/ }).first().waitFor({ timeout: 8000 });
check("tax report: accounting method change is applied and shown", true);
const [csvDl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), rpt.getByRole("button", { name: "DOWNLOAD CSV" }).click()]);
const csvText = (await import("node:fs")).readFileSync(await csvDl.path(), "utf8");
check("CSV download: safe filename, header row with all columns, CRLF, no secrets", /^estimated-tax-report-\d{4}-hifo-[0-9a-f]{12}\.csv$/.test(csvDl.suggestedFilename()) && csvText.split("\r\n")[0].split(",").length === 31 && csvText.startsWith("report_status,tax_year,asset") && !csvText.includes("pn_session") && !csvText.includes("127.0.0.1"), JSON.stringify([csvDl.suggestedFilename(), csvText.slice(0, 120)]));
const [jsonDl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), rpt.getByRole("button", { name: "DOWNLOAD JSON" }).click()]);
const jsonRep = JSON.parse((await import("node:fs")).readFileSync(await jsonDl.path(), "utf8"));
check("JSON download: metadata, status, summary, provenance, manual basis disclosure, fingerprint; accounting method HIFO; verifiedOnChain false", jsonRep.accountingMethod === "HIFO" && jsonRep.status === "COMPLETE" && jsonRep.manualBasis.disclosure === "Includes user-provided tax data." && /^[0-9a-f]{64}$/.test(jsonRep.fingerprint) && jsonRep.provenance.verifiedOnChain === false && jsonRep.label === "ESTIMATED_TAX_REPORT" && !JSON.stringify(jsonRep).includes("<img"));
const apiRep = await (await apiGet(`/api/tax/${WALLET_ID}/report?taxYear=${jsonRep.taxYear}&method=HIFO`)).json();
check("report API equals the downloaded JSON (same fingerprint and hash)", apiRep.fingerprint === jsonRep.fingerprint && apiRep.reportHash === jsonRep.reportHash);
check("report export requires a session and is refused for rates in a URL", (await fetch(`${API}/api/tax/${WALLET_ID}/report`)).status === 401 && (await apiGet(`/api/tax/${WALLET_ID}/report?shortTermRateBps=1&longTermRateBps=1&stateRateBps=1`)).status() === 400);
await shot("5e-tax-report");

// 6. API protection (no cookie => 401; foreign wallet ids are not reachable)
const anon = await fetch(`${API}/api/wallets/${WALLET_ID}/manual-basis`);
check("manual basis API requires a session", anon.status === 401);
check("no DELETE route exists", (await context.request.delete(`${API}/api/wallets/${WALLET_ID}/manual-basis/${all.records[0].id}`, { headers: { origin: WEB } })).status() === 404);
await shot("5d-manual-basis");

await go("/tax-reserve");
t = await text();
check("tax reserve (real wallet): balance UNAVAILABLE not $0, no demo reserve, no target yet, funding not enabled", t.includes("RESERVE BALANCE UNAVAILABLE") && t.includes("No reserve target set.") && t.includes("Reserve funding is not enabled in this beta.") && !t.includes("$14,200") && !t.includes("DEMO") && !/\$0\b/.test(t), t.slice(0, 1200));
check("tax reserve (real wallet): without the user's own rates there is no recommendation and no rate is assumed", t.includes("RATES REQUIRED FOR A RESERVE ESTIMATE") && t.toLowerCase().includes("none are assumed"));
await page.getByLabel("Short-term rate %").fill("30");
await page.getByLabel("Long-term rate %").fill("15");
await page.getByLabel("State rate %").fill("0");
await page.getByRole("button", { name: "RECALCULATE" }).click();
await page.getByText(/ESTIMATED RESERVE|TAX DATA REQUIRED — NO RESERVE RECOMMENDATION/).first().waitFor({ timeout: 10000 });
t = await text();
const label = t.includes("ESTIMATED RESERVE TARGET") ? "COMPLETE" : t.includes("ESTIMATED RESERVE — TAX DATA INCOMPLETE") ? "PARTIAL" : t.includes("TAX DATA REQUIRED — NO RESERVE RECOMMENDATION") ? "DATA_REQUIRED" : "?";
check("tax reserve: the recommendation never claims more certainty than the tax status", (label === "COMPLETE" && t.includes("TAX DATA COMPLETE")) || (label === "PARTIAL" && t.includes("TAX DATA INCOMPLETE")) || (label === "DATA_REQUIRED" && t.includes("TAX DATA REQUIRED") && t.includes("What is missing")), `${label} :: ${t.slice(0, 800)}`);
check("tax reserve: still no balance, coverage or remaining after a recommendation exists", t.includes("RESERVE BALANCE UNAVAILABLE") && (t.match(/UNAVAILABLE/g) ?? []).length >= 3 && !/guarantee|your tax (bill|liability)|tax-free/i.test(t));
await page.getByRole("button", { name: "SET RESERVE TARGET" }).click();
await page.getByLabel("Reserve target in USDC").fill("8000");
await page.getByRole("button", { name: "REVIEW TARGET" }).click();
await page.getByRole("alertdialog").waitFor({ timeout: 4000 });
check("tax reserve: setting a target asks for confirmation first, and nothing is saved yet", (await (await apiGet(`/api/tax-reserve/${WALLET_ID}`)).json()).userTarget.set === false);
await page.getByRole("button", { name: "CONFIRM AND SAVE" }).click();
await page.getByText("Target saved.").first().waitFor({ timeout: 8000 });
t = await text();
const saved = await (await apiGet(`/api/tax-reserve/${WALLET_ID}`)).json();
check("tax reserve: the saved target is a setting (USER_SET), not a balance; coverage stays unavailable", saved.userTarget.source === "USER_SET" && saved.userTarget.targetAmountCents === "800000" && saved.userTarget.isMoney === false && saved.reserveBalance.cents === null && saved.coverage.available === false && t.includes("$8,000") && t.includes("RESERVE BALANCE UNAVAILABLE"), JSON.stringify(saved.userTarget));
check("tax reserve: the target is not shown as deposited, funded, held or secured", !/deposited|funded|secured|held in/i.test(t.replace(/not enabled/gi, "")));
const reserveUrl = `${API}/api/tax-reserve/${WALLET_ID}`;
check("tax reserve API: 401 without a session, tax rates in a URL are refused", (await fetch(reserveUrl)).status === 401 && (await apiGet(`/api/tax-reserve/${WALLET_ID}?shortTermRateBps=3000`)).status() === 400);
check("tax reserve API: no deposit, withdraw or transfer route exists, and a save needs confirmation", (await Promise.all(["deposit", "withdraw", "transfer"].map((p) => context.request.post(`${API}/api/tax-reserve/${WALLET_ID}/${p}`, { headers: { origin: WEB }, data: {} })))).every((r) => r.status() === 404) && (await context.request.post(`${reserveUrl}/target`, { headers: { origin: WEB }, data: { targetType: "amount", targetAmount: "1.00" } })).status() === 400);
check("tax reserve API: another user's reserve is not readable (demo wallet id is 404 for this session)", (await apiGet("/api/tax-reserve/00000000-0000-4000-8000-000000000001")).status() === 404);
await shot("5e-tax-reserve");

await go("/give");
t = await text();
check("give: registry from the API; fixture verification is labeled, never real-world", t.includes("CHARITY REGISTRY") && t.includes("VERIFIED (FIXTURE, NOT REAL-WORLD)") && t.includes("PENDING REVIEW") && ["verification status", "verification source", "last reviewed"].every((l) => t.toLowerCase().includes(l)), t.slice(0, 900));
check("give: no 'safe' or 'guaranteed' claims anywhere on the page", !/\bsafe\b|guarantee|IRS approved|tax write-off/i.test(t));
check("give: transfers are not enabled and nothing can be confirmed", t.includes("TRANSFERS NOT ENABLED") && t.includes("Donation transfers are not enabled in this beta."));
check("give: no donation records for this wallet, nothing invented", t.includes("NO DONATIONS YET") && !t.includes("DEMO RECORD ·") && !t.includes("DEMO RECEIPT"));
await page.getByRole("button", { name: "View evidence for Open Water Initiative (demo)" }).click();
await page.getByText("Selected charity").waitFor({ timeout: 8000 });
await page.getByText("does not prove legitimacy").waitFor({ timeout: 8000 });
t = await text();
check("give: selected charity shows evidence with source, status and the caveat", t.toLowerCase().includes("evidence") && t.includes("FIXTURE") && t.includes("not a real-world verification") && t.toLowerCase().includes("checked"), t.slice(0, 1200));
const charitySearch = page.getByLabel("Search charities");
await charitySearch.fill("reforest");
await page.waitForTimeout(200);
t = await text();
const evidenceButtons = page.getByRole("button", { name: /^View evidence for / });
check("give: search filters the registry as plain text", await evidenceButtons.count() === 1 && (await evidenceButtons.first().getAttribute("aria-label")).includes("Reforest Together (demo)"));
await charitySearch.fill("");
await page.getByLabel("Amount (USDC)").fill("25.50");
await page.getByRole("button", { name: "REVIEW DONATION" }).click();
await page.getByText("REVIEW ONLY · NOTHING SENT").waitFor({ timeout: 8000 });
t = await text();
check("give: donation review shows asset, amount, USD reference, fee and tax wording and sends nothing", t.includes("25.5") && t.includes("$25.50") && t.toLowerCase().includes("network fee") && t.includes("Potentially deductible charitable contribution") && t.includes("not automatically the deductible amount") && t.includes("explicitly sign"), t.slice(0, 1500));
check("give: the final action is disabled with the beta message", await page.getByRole("button", { name: "CONFIRM DONATION" }).isDisabled() && t.includes("Donation transfers are not enabled in this beta."));
check("give: review created no record and no signature", !/success|thank you|signature/i.test(t) && (await (await apiGet(`/api/donations/${WALLET_ID}`)).json()).donations.length === 0);
// ownership: this session cannot read the demo user's donation or receipt, and there is no create endpoint
const DEMO_DONATION = "00000000-0000-4000-8000-000000000501", DEMO_RCPT = "00000000-0000-4000-8000-000000000701";
check("give: another user's donation and receipt are 404 (no IDOR)", (await apiGet(`/api/donations/by-id/${DEMO_DONATION}`)).status() === 404 && (await apiGet(`/api/receipts/${DEMO_RCPT}`)).status() === 404 && (await apiGet("/api/donations/00000000-0000-4000-8000-000000000001")).status() === 404);
check("give: there is no donation creation endpoint", (await context.request.post(`${API}/api/donations`, { headers: { origin: WEB }, data: { walletId: WALLET_ID, charityId: "00000000-0000-4000-8000-000000000201", amount: "1" } })).status() === 404);
const evidenceJson = await (await context.request.get(`${API}/api/charities/00000000-0000-4000-8000-000000000201/evidence`)).text();
check("give: public evidence exposes no verifier identity or internal notes", !/verifier|internal|notes/i.test(evidenceJson), evidenceJson.slice(0, 300));
await shot("6-give");

await go("/discover");
t = await text();
check("discover: demo tokens are labeled DEMO DATA with the API ranking rule", t.includes("DEMO DATA") && t.includes("Ranking rule:") && t.includes("Orchard Demo"));
await page.getByRole("tab", { name: "Verified Transparency" }).click();
await page.waitForTimeout(500);
t = await text();
check("discover: the Verified Transparency filter uses the SERVER flag: no demo token qualifies, and nothing says VERIFIED TRANSPARENCY", t.includes("NO TOKENS MATCH") && !t.includes("Harbor Demo Token") && !/VERIFIED TRANSPARENCY\n/.test(t), t.slice(0, 600));
await page.getByRole("tab", { name: "New" }).click();
await page.waitForTimeout(500);
t = await text();
check("discover: New filter returns only recent launches", t.includes("Lantern Demo") && t.includes("Fieldnotes Demo") && !t.includes("Orchard Demo"));
await shot("7-discover");

await go("/token/demo");
t = await page.locator("body").innerText();
check("proof: demo token says blockchain verification is not connected and never claims verification", t.includes("BLOCKCHAIN VERIFICATION NOT YET CONNECTED") && t.includes("DEMO DATA") && !t.includes("VERIFIED TRANSPARENCY") && t.includes("Not deployed. This is a demo token."));
await shot("8-proof");

// Launch (Slice 11): configure, validate, review, mark READY. Nothing is deployed, minted or sent.
await go("/launch");
await page.waitForTimeout(500);
t = await text();
check("launch: wizard recognizes the authenticated wallet", t.includes("Authenticated:") && t.includes("CONFIGURE LAUNCH"));
check("launch: starts with no saved configurations (nothing fabricated)", t.includes("NO SAVED CONFIGURATIONS") && (await (await apiGet("/api/launches")).json()).launches.length === 0);
const next = () => page.getByRole("button", { name: "CONTINUE", exact: true }).click();
await next(); // create
await next(); // info
await page.locator("#t-name").fill("E2E Token");
await page.locator("#t-symbol").fill("E2E");
await page.locator("#t-website").fill("javascript:alert(1)");
await page.getByText("Website must be an http or https URL.").waitFor({ timeout: 3000 });
check("launch: a dangerous website URL is refused and CONTINUE is blocked", await page.getByRole("button", { name: "CONTINUE", exact: true }).isDisabled());
await page.locator("#t-website").fill("https://example.org");
await page.locator("#t-image").fill("https://example.org/e2e.png");
await next(); // supply
await next(); // liquidity
await next(); // fees
t = await text();
check("launch: the fee split is fixed 60/15/15/10, shown as configuration, with nothing to edit", t.includes("FIXED FOR THIS VERSION") && t.includes("60%") && t.includes("10%") && t.includes("It is not enforced on-chain.") && (await page.locator("main input[inputmode='decimal']").count()) === 0 && !/immutable/i.test(t), t.slice(0, 700));
await next(); // charity
await next(); // reserve
t = await text();
check("launch: the tax reserve allocation is not your personal Tax Reserve", t.includes("Tax reserve destination") || t.toLowerCase().includes("tax reserve allocation"));
await next(); // review
await page.getByRole("button", { name: "SAVE DRAFT" }).waitFor();
t = await text();
check("launch review: nothing deployed notice and fixed allocations", t.includes("NOTHING IS DEPLOYED") && t.includes("CONFIGURED ALLOCATIONS") && t.includes("Configured creator allocation"));
await page.getByRole("button", { name: "SAVE DRAFT" }).click();
await page.getByText("Not validated yet.").first().waitFor({ timeout: 8000 });
t = await text();
let stored = (await (await apiGet("/api/launches")).json()).launches;
check("launch: saved as a DRAFT with a fingerprint, NOT DEPLOYED, NOT VERIFIED ON-CHAIN", t.includes("NOT DEPLOYED") && t.includes("NOT VERIFIED ON-CHAIN") && t.includes(stored[0]?.fingerprint ?? "x") && stored.length === 1 && stored[0].status === "DRAFT" && /^[0-9a-f]{64}$/.test(stored[0].fingerprint) && stored[0].metadata.verifiedOnChain === false);
const LAUNCH_ID = stored[0].id;
await page.getByRole("button", { name: "VALIDATE CONFIGURATION" }).click();
await page.getByText("Server validation passed this configuration.").first().waitFor({ timeout: 8000 });
t = await text();
check("launch: validation shows the charity's registry state with source and last reviewed, and a fixture caveat; no donation promise", t.includes("VERIFIED (FIXTURE, NOT REAL-WORLD)") && t.includes("Verification source") && t.toLowerCase().includes("last reviewed") && t.includes("does not execute a donation") && t.includes("Deployable: no"));
check("launch: the server moved it to CONFIGURED", (await (await apiGet(`/api/launches/${LAUNCH_ID}`)).json()).status === "CONFIGURED");
check("launch: READY is not offered before review", (await page.getByRole("button", { name: "MARK READY FOR DEPLOYMENT" }).count()) === 0);
await page.getByRole("button", { name: "SUBMIT FOR REVIEW" }).click();
await page.getByText("IN REVIEW").first().waitFor({ timeout: 8000 });
await page.getByRole("button", { name: "MARK READY FOR DEPLOYMENT" }).waitFor();
check("launch: marking READY needs explicit confirmation", await page.getByRole("button", { name: "MARK READY FOR DEPLOYMENT" }).isDisabled());
await page.getByLabel(/I have reviewed this exact configuration/).check();
await page.getByLabel(/Make this configuration publicly viewable/).check();
await page.getByRole("button", { name: "MARK READY FOR DEPLOYMENT" }).click();
await page.getByText("Configuration validated.").first().waitFor({ timeout: 8000 });
t = await text();
const ready = await (await apiGet(`/api/launches/${LAUNCH_ID}`)).json();
check("launch: READY means ready for a future flow, never deployed", t.includes("READY FOR DEPLOYMENT") && t.includes("No on-chain transaction has been submitted") && t.includes("On-chain deployment is not enabled in this beta.") && !/\bLIVE\b|launched successfully/i.test(t) && ready.status === "READY" && ready.deployment.status === "not_deployed" && ready.deployment.mintAddress === null && ready.deployment.transactionSignature === null && ready.publicVisible === true);
await next(); // deploy
t = await text();
check("launch: the final step says READY FOR DEPLOYMENT and cannot be passed", t.includes("READY FOR DEPLOYMENT") && t.includes("On-chain deployment is not enabled in this beta.") && await page.getByRole("button", { name: "CONTINUE", exact: true }).isDisabled());
await shot("9-launch");

// public, read-only view of the published configuration
await go("/launches");
await page.waitForTimeout(500);
t = await text();
check("public launches: the published configuration is listed as CONFIGURED / NOT DEPLOYED / NOT VERIFIED ON-CHAIN", t.includes("E2E Token") && t.includes("NOT DEPLOYED") && t.includes("NOT VERIFIED ON-CHAIN") && !t.includes("DEMO DATA"));
await page.getByRole("link", { name: "VIEW CONFIGURATION" }).first().click();
await page.getByText("Configured allocations").first().waitFor({ timeout: 8000 });
t = await text();
check("public launch view: allocations, charity status, fingerprint, user-provided metadata; no wallet address", t.toLowerCase().includes("configured allocations") && t.includes("Clear Sky Education Fund (demo)") && t.includes("VERIFIED (FIXTURE, NOT REAL-WORLD)") && t.includes(ready.fingerprint) && t.includes("USER-PROVIDED") && !t.includes(ADDRESS) && !t.includes("AUTHENTICATED"), t.slice(0, 1800) + JSON.stringify({ alloc: t.toLowerCase().includes("configured allocations"), charity: t.includes("Clear Sky Education Fund (demo)"), fixture: t.includes("VERIFIED (FIXTURE, NOT REAL-WORLD)"), fp: t.includes(ready.fingerprint), up: t.includes("USER-PROVIDED"), addr: t.includes(ADDRESS), auth: t.includes("AUTHENTICATED") }));
const pub = await (await fetch(`${API}/api/public/launches/${LAUNCH_ID}`)).text();
check("public launch API: readable without a session and exposes no user id, session, wallet address or reserve destination", pub.includes('"name":"E2E Token"') && !pub.includes(ADDRESS) && !/creatorWallet|destinationAddress|userId|creatorUserId|session/i.test(pub));

// authorization, status control and the absence of any deployment surface
const unauth = await fetch(`${API}/api/launches`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
check("launch API: creation and private reads need a session", unauth.status === 401 && (await fetch(`${API}/api/launches/${LAUNCH_ID}`)).status === 401 && (await fetch(`${API}/api/launches/${LAUNCH_ID}/history`)).status === 401);
const cfg0 = { ...ready.config };
const put = (body) => context.request.put(`${API}/api/launches/${LAUNCH_ID}`, { headers: { origin: WEB }, data: body });
check("launch API: a client cannot send a status or change the fee split", (await put({ ...cfg0, status: "LIVE" })).status() === 400 && (await put({ ...cfg0, feeSplit: { creator: 5000, taxReserve: 2500, charity: 1500, protocol: 1000 } })).status() === 400 && (await context.request.post(`${API}/api/launches/${LAUNCH_ID}/ready`, { headers: { origin: WEB }, data: { fingerprint: ready.fingerprint, confirmed: true, status: "LIVE" } })).status() === 400);
check("launch API: no deploy, mint, liquidity, payout or donation endpoint exists", (await Promise.all(["deploy", "mint", "liquidity", "distribute", "payout", "donate"].map((p) => context.request.post(`${API}/api/launches/${LAUNCH_ID}/${p}`, { headers: { origin: WEB }, data: {} })))).every((r) => r.status() === 404));
check("launch API: another user's launch id is a 404", (await apiGet("/api/launches/00000000-0000-4000-8000-0000000fffff")).status() === 404);

// token proof: a real READY launch was never deployed, so it is NOT DEPLOYED and nothing is invented or verified
const ownProof = await (await apiGet(`/api/launches/${LAUNCH_ID}/proof`)).json();
check("token proof API (owner): NOT DEPLOYED, no mint/signature/explorer/observed timestamp, nothing verified", ownProof.status === "NOT_DEPLOYED" && ownProof.verifiedOnChain === false && ownProof.verifiedTransparency === false && ownProof.identity.mintAddress === null && ownProof.identity.deploymentSignature === null && ownProof.identity.observedAt === null && ownProof.identity.explorerUrl === null && ownProof.observed === null && ownProof.checks.length === 0);
const pubProofRes = await fetch(`${API}/api/public/launches/${LAUNCH_ID}/proof`);
const pubProofText = await pubProofRes.text();
check("token proof API (public): readable without a session, no wallet address, reserve destination, user id or session", pubProofRes.status === 200 && !pubProofText.includes(ADDRESS) && JSON.parse(pubProofText).configured.taxReserve.destination === null && !/creatorUserId|userId|session|destinationAddress/i.test(pubProofText));
check("token proof API: needs a session for the owner view; writes do not exist; unknown ids are 404", (await fetch(`${API}/api/launches/${LAUNCH_ID}/proof`)).status === 401 && (await context.request.post(`${API}/api/launches/${LAUNCH_ID}/proof`, { headers: { origin: WEB }, data: { status: "VERIFIED", verifiedOnChain: true } })).status() === 404 && (await apiGet("/api/launches/00000000-0000-4000-8000-0000000fffff/proof")).status() === 404 && (await fetch(`${API}/api/public/launches/00000000-0000-4000-8000-0000000fffff/proof`)).status === 404);
await go(`/launch/proof?id=${LAUNCH_ID}`);
await page.getByText("A · IDENTITY").first().waitFor({ timeout: 8000 });
t = await text();
check("token proof page (owner): NOT DEPLOYED, sections A-G, disclosure wording, no VERIFIED TRANSPARENCY, no fixture label", t.includes("NOT DEPLOYED") && ["A · IDENTITY", "B · CONFIGURATION", "C · OBSERVED ON-CHAIN", "D · VERIFICATION CHECKS", "E · MISMATCHES", "F · PROVENANCE", "G · DISCLOSURE"].every((x) => t.includes(x)) && t.includes("Configured values describe the intended launch configuration. They are not blockchain proof.") && !/VERIFIED TRANSPARENCY(?! is shown only)/.test(t) && !t.includes("FIXTURE") && !/\$0\b/.test(t), t.slice(0, 900));
await go(`/launches/proof?id=${LAUNCH_ID}`);
await page.getByText("IN PLAIN WORDS").first().waitFor({ timeout: 8000 });
t = await text();
check("token proof page (public): plain-words answers, NOT DEPLOYED, no scenario picker against a real API, no wallet address", ["What was promised?", "What was observed?", "Do they match?", "What could not be verified?", "NOT DEPLOYED"].every((x) => t.includes(x)) && !t.includes("FIXTURE SCENARIO") && !t.includes(ADDRESS), t.slice(0, 900));
await shot("9b-token-proof");

// editing returns the launch to DRAFT, un-publishes it, changes the fingerprint and is recorded
const edited = await put({ ...cfg0, description: "edited by e2e" });
const editedBody = await edited.json();
check("launch: an edit returns it to DRAFT, hides it publicly and changes the fingerprint", edited.status() === 200 && editedBody.status === "DRAFT" && editedBody.publicVisible === false && editedBody.fingerprint !== ready.fingerprint && (await fetch(`${API}/api/public/launches/${LAUNCH_ID}`)).status === 404);
const hist = await (await apiGet(`/api/launches/${LAUNCH_ID}/history`)).json();
check("launch: the configuration history records every step and its hash chain verifies", JSON.stringify(hist.revisions.map((r) => r.action)) === JSON.stringify(["create", "configure", "review", "ready", "update"]) && hist.historyIntact === true && /not a blockchain proof/.test(hist.note));
await go("/launch");
await page.waitForTimeout(600);
check("launch: the saved configuration appears in your list (GET /api/launches)", (await text()).includes("E2E Token"));
await page.getByRole("button", { name: "VIEW", exact: true }).first().click();
await page.getByText("Configuration id").first().waitFor({ timeout: 5000 });
check("launch: detail loads through GET /api/launches/:id and shows the edited DRAFT", (await text()).includes("DRAFT") && (await text()).includes("edited by e2e"));
await page.getByRole("button", { name: "HISTORY", exact: true }).last().click();
await page.getByText("Configuration history").first().waitFor({ timeout: 5000 });
check("launch: history is visible with the hash-chain caveat", (await text()).includes("Hash chain verified.") && (await text()).includes("not a blockchain proof"));

// 5. Reload restores the session from the cookie
await page.reload({ waitUntil: "networkidle" });
await page.getByText("AUTHENTICATED", { exact: true }).first().waitFor({ timeout: 5000 }).catch(() => {});
check("after reload the app is still AUTHENTICATED (cookie session)", (await page.getByText("AUTHENTICATED", { exact: true }).count()) > 0);

// 6. Replay of the captured request fails
const nonce = msg.match(/Nonce: (\S+)/)[1];
const replay = await context.request.post(`${API}/api/auth/verify`, {
  headers: { origin: WEB },
  data: { address: ADDRESS, nonce, message: msg, signature: Buffer.from(sign(null, Buffer.from(msg), privateKey)).toString("base64") },
});
check("replaying the exact signed request is rejected", replay.status() === 401);

// 7. Log out
await page.locator("header").first().getByRole("button", { name: /AUTHENTICATED|^[A-Za-z0-9]{4}…/ }).first().click();
await page.getByRole("menuitem").first().waitFor({ timeout: 2000 }).catch(() => {});
const logoutResponse = page.waitForResponse((r) => r.url().endsWith("/api/auth/logout"), { timeout: 10000 });
await page.getByRole("button", { name: "LOG OUT & DISCONNECT" }).click();
await logoutResponse; // the server must have answered before its effect is checked
await page.getByRole("button", { name: "CONNECT WALLET" }).first().waitFor();
check("logout: UI returns to CONNECT WALLET", true);
check("logout: server session is revoked (old cookie no longer works)", (await context.cookies(API)).every((c) => c.name !== "pn_session") && (await apiGet("/api/wallets")).status() === 401);
if (sc) {
  const stale = await fetch(`${API}/api/wallets`, { headers: { cookie: `pn_session=${sc.value}` } });
  check("logout: replaying the old cookie value is rejected by the API", stale.status === 401);
}
await shot("4-logged-out");
await go("/portfolio");
check("after logout: portfolio asks for authentication (no stale data)", (await text()).includes("AUTHENTICATION REQUIRED"));
check("after logout: topbar status is DISCONNECTED", (await page.locator("header").first().innerText()).includes("DISCONNECTED") && !(await page.locator("header").first().innerText()).includes("AUTHENTICATED"));
await go("/launch");
check("after logout: launch list asks for sign in", (await text()).includes("Sign in to see your saved launch configurations"));

check("no console errors", consoleErrors.filter((e) => !/401|Failed to load resource/.test(e)).length === 0, consoleErrors.join(" | "));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
