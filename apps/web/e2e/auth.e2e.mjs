/**
 * End-to-end check of real wallet sign-in in a browser.
 *
 * Needs: API on :4000 and web on :3000 built with NEXT_PUBLIC_API_MODE=api (see docs/ENVIRONMENT.md).
 * Run:   pnpm --filter @project-name/web e2e:auth
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
check("topbar offers CONNECT WALLET", (await page.getByRole("button", { name: "CONNECT WALLET" }).count()) > 0);

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
await page.locator("header").getByRole("button", { name: /AUTHENTICATED|^[A-Za-z0-9]{4}…/ }).first().click();
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

check("no console errors", consoleErrors.filter((e) => !/401|Failed to load resource/.test(e)).length === 0, consoleErrors.join(" | "));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `\nALL ${results.length} CHECKS PASSED` : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
