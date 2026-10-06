/**
 * End-to-end check of the real stack in a browser (API mode): wallet sign-in, every screen, logout.
 *
 * Needs: API on :4000 (database migrated AND seeded with `pnpm db:seed-demo` so the demo charities exist)
 *        and web on :3000 built with NEXT_PUBLIC_API_MODE=api (see docs/ENVIRONMENT.md).
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
check("portfolio: authenticated wallet with no indexed data gets the empty state", t.includes("NO LIVE PORTFOLIO DATA YET") && t.includes("Your wallet is authenticated, but blockchain indexing has not been connected yet."));
check("portfolio: no demo balances are attached to the real wallet", !/DEMO DATA|\$34,235|\$42,810|BONK|JUP/.test(t), t.slice(0, 300));
check("portfolio: transactions empty state, nothing invented", t.includes("NO LIVE TRANSACTIONS YET") && !t.includes("DEMO-SIG"));
await shot("5-portfolio-empty");

await go("/tax");
t = await text();
check("tax: no live data empty state, no demo estimate", t.includes("NO LIVE TAX DATA YET") && !t.includes("$18,420") && !/your tax bill/i.test(t));

await go("/tax-reserve");
t = await text();
check("tax reserve: empty state for the real wallet; funding stays unavailable", t.includes("NO LIVE TAX RESERVE DATA YET") && !t.includes("$14,200"));

await go("/give");
t = await text();
check("give: charity information from the API with demo verification labeled", t.includes("CHARITY INFORMATION") && t.includes("VERIFIED (DEMO DATA)") && t.includes("PENDING REVIEW"));
check("give: on-chain donation is unavailable and donate is disabled", t.includes("ACTUAL ON-CHAIN DONATION") && await page.getByRole("button", { name: "DONATE" }).isDisabled());
check("give: no donation records for this wallet, nothing invented", t.includes("NO DONATIONS YET") && !t.includes("DEMO RECORD ·"));
await shot("6-give");

await go("/discover");
t = await text();
check("discover: demo tokens are labeled DEMO DATA with the API ranking rule", t.includes("DEMO DATA") && t.includes("Ranking rule:") && t.includes("Orchard Demo"));
await page.getByRole("tab", { name: "Verified Transparency" }).click();
await page.waitForTimeout(500);
t = await text();
check("discover: Verified Transparency filter is the API's (all 9 checks REPORTED), never 'verified'", t.includes("Harbor Demo Token") && t.includes("Orchard Demo") && !t.includes("Lantern Demo") && !t.includes("VERIFIED TRANSPARENCY\n") && t.includes("ALL 9 CHECKS REPORTED"));
await page.getByRole("tab", { name: "New" }).click();
await page.waitForTimeout(500);
t = await text();
check("discover: New filter returns only recent launches", t.includes("Lantern Demo") && t.includes("Fieldnotes Demo") && !t.includes("Orchard Demo"));
await shot("7-discover");

await go("/token/demo");
t = await page.locator("body").innerText();
check("proof: demo token says blockchain verification is not connected and never claims verification", t.includes("BLOCKCHAIN VERIFICATION NOT YET CONNECTED") && t.includes("DEMO DATA") && !t.includes("VERIFIED TRANSPARENCY") && t.includes("Not deployed. This is a demo token."));
await shot("8-proof");

// Launch: prepare, save, review. Nothing is deployed.
await go("/launch");
await page.waitForTimeout(500);
t = await text();
check("launch: wizard recognizes the authenticated wallet", t.includes("Authenticated:") && t.includes("PREPARE LAUNCH"));
check("launch: starts with no saved configurations", t.includes("NO SAVED CONFIGURATIONS"));
const next = () => page.getByRole("button", { name: "CONTINUE", exact: true }).click();
await next(); // create
await next(); // info
await page.locator("#t-name").fill("E2E Token");
await page.locator("#t-symbol").fill("E2E");
await next(); // supply
await next(); // liquidity
await next(); // fees
await next(); // charity
await next(); // reserve
await next(); // review
await page.getByRole("button", { name: "SAVE LAUNCH CONFIGURATION" }).waitFor();
check("launch review: nothing deployed notice", (await text()).includes("NOTHING IS DEPLOYED"));
await page.getByRole("button", { name: "SAVE LAUNCH CONFIGURATION" }).click();
await page.getByText("DRAFT", { exact: true }).first().waitFor({ timeout: 8000 });
check("launch: saved as a DRAFT, NOT DEPLOYED", (await text()).includes("NOT DEPLOYED") && (await page.getByText("Not reviewed yet.").count()) === 1);
await page.getByRole("button", { name: "RUN SERVER REVIEW" }).click();
await page.getByText("REVIEW PASSED").first().waitFor({ timeout: 8000 });
t = await text();
check("launch: server review passed; fee split is 'Configured fee split', not enforced, not deployable", t.includes("Configured fee split") && t.includes("not enforced") && t.includes("Deployable: no") && !/immutable/i.test(t));
const launches = await (await apiGet("/api/launches")).json();
check("launch: the API stored exactly this configuration for this user", launches.launches.length === 1 && launches.launches[0].status === "review_passed" && launches.launches[0].deployment.status === "not_deployed" && launches.launches[0].config.creatorWallet === ADDRESS);
await next(); // deploy (unavailable)
t = await text();
check("launch: deploy step is unavailable and cannot be passed", t.includes("DEPLOYMENT NOT AVAILABLE") && await page.getByRole("button", { name: "CONTINUE", exact: true }).isDisabled());
await shot("9-launch");
await go("/launch");
await page.waitForTimeout(600);
check("launch: saved configuration appears in your list (GET /api/launches)", (await text()).includes("E2E Token"));
await page.getByRole("button", { name: "VIEW", exact: true }).first().click();
await page.getByText("Configuration id").first().waitFor({ timeout: 5000 });
check("launch: detail loads through GET /api/launches/:id", (await text()).includes("REVIEW PASSED"));

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
await page.getByRole("button", { name: "LOG OUT & DISCONNECT" }).click();
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
