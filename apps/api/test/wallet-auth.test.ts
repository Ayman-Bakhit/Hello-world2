import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { getProgramDerivedAddress, address as toAddress } from "@solana/addresses";
import { generateKeyPair } from "@solana/keys";
import { DEMO_IDS, DEMO_WALLETS, SIGN_IN_STATEMENT, buildSignInMessage, parseSignInMessage } from "@project-name/shared";
import { parseSignerAddress, verifyEd25519 } from "../src/auth/solana";
import { createSession } from "../src/auth/session";
import { ORIGIN, bearer, cookieValue, makeCtx, makeSigner, requestNonce, signIn, type Ctx } from "./helpers";

let ctx: Ctx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.close(); });

const browser = { origin: ORIGIN };
const verify = (payload: unknown, headers: Record<string, string> = browser) => ctx.app.inject({ method: "POST", url: "/api/auth/verify", payload: payload as object, headers });
const counts = async () => (await ctx.pool.query("SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM wallets) AS wallets, (SELECT count(*)::int FROM sessions) AS sessions")).rows[0] as { users: number; wallets: number; sessions: number };
const sha = (t: string) => createHash("sha256").update(t).digest();
const flip = (s: string) => (s.startsWith("A") ? "B" : "A") + s.slice(1);

async function challengeFor(signer: { address: string }) {
  const n = await requestNonce(ctx.app, signer.address);
  expect(n.statusCode).toBe(200);
  return n.json() as { nonce: string; message: string; issuedAt: string; expiresAt: string };
}
async function expectRejected(res: { statusCode: number; json: () => { error: { code: string } }; headers: Record<string, unknown> }, before: { users: number; wallets: number; sessions: number }) {
  expect(res.statusCode).toBe(401);
  expect(res.json().error.code).toBe("AUTH_FAILED");
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(await counts()).toEqual(before);
}

describe("solana helpers (official Kit packages, no custom crypto)", () => {
  it("accepts real on-curve addresses; rejects garbage and PDAs", async () => {
    const s = await makeSigner();
    expect(parseSignerAddress(s.address)).toBe(s.address);
    for (const bad of ["", "0OIl", "short", "x".repeat(60), DEMO_WALLETS[0]!.address]) expect(parseSignerAddress(bad), bad).toBeNull();
    const [pda] = await getProgramDerivedAddress({ programAddress: toAddress("11111111111111111111111111111111"), seeds: ["test"] });
    expect(parseSignerAddress(pda)).toBeNull(); // off-curve: no private key can exist
  });
  it("verifyEd25519 true only for the right key and message, and never throws", async () => {
    const a = await makeSigner(), b = await makeSigner();
    const sigA = new Uint8Array(Buffer.from(await a.sign("hello"), "base64"));
    expect(await verifyEd25519(a.address, "hello", sigA)).toBe(true);
    expect(await verifyEd25519(a.address, "hellp", sigA)).toBe(false);
    expect(await verifyEd25519(b.address, "hello", sigA)).toBe(false);
    expect(await verifyEd25519(a.address, "hello", new Uint8Array(63))).toBe(false);
    expect(await verifyEd25519(a.address, "hello", new Uint8Array(64))).toBe(false);
    expect(await verifyEd25519("not an address", "hello", sigA)).toBe(false);
    const kp = await generateKeyPair(); // unused: ensure test key generation itself is local and ephemeral
    expect(kp.privateKey.extractable).toBe(false);
  });
});

describe("nonce creation", () => {
  it("issues a 192-bit nonce, the exact documented message, a 5 minute window, and stores it", async () => {
    const s = await makeSigner();
    const n = await requestNonce(ctx.app, s.address);
    expect(n.statusCode).toBe(200);
    expect(n.headers["cache-control"]).toBe("no-store");
    const b = n.json();
    expect(b.nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(b).toMatchObject({ domain: "localhost:3000", chainId: "solana:devnet" });
    expect(Date.parse(b.expiresAt) - Date.parse(b.issuedAt)).toBe(300_000);
    const f = parseSignInMessage(b.message)!;
    expect(f).toMatchObject({ address: s.address, nonce: b.nonce, uri: ORIGIN, domain: "localhost:3000", issuedAt: b.issuedAt, expirationTime: b.expiresAt });
    expect(b.message).toBe(buildSignInMessage(f));
    expect(b.message).toContain(SIGN_IN_STATEMENT);
    const row = (await ctx.pool.query("SELECT message, address, consumed_at FROM auth_nonces WHERE nonce = $1", [b.nonce])).rows[0];
    expect(row).toMatchObject({ message: b.message, address: s.address, consumed_at: null });
  });
  it("nonces are unique and not derived from the address or time", async () => {
    const s = await makeSigner();
    const nonces = new Set<string>();
    for (let i = 0; i < 8; i++) nonces.add((await challengeFor(s)).nonce);
    for (let i = 0; i < 8; i++) nonces.add((await challengeFor(await makeSigner())).nonce);
    expect(nonces.size).toBe(16);
    for (const n of nonces) { expect(n).not.toContain(s.address.slice(0, 8)); expect(n).not.toMatch(/^\d+$/); }
  });
  it("rejects invalid addresses, extra fields, other chains", async () => {
    const [pda] = await getProgramDerivedAddress({ programAddress: toAddress("11111111111111111111111111111111"), seeds: ["x"] });
    for (const payload of [{}, { address: "nope" }, { address: pda }, { address: DEMO_WALLETS[0]!.address }, { address: (await makeSigner()).address, chain: "eth" }, { address: (await makeSigner()).address, x: 1 }]) {
      const r = await ctx.app.inject({ method: "POST", url: "/api/auth/nonce", payload, headers: browser });
      expect(r.statusCode, JSON.stringify(payload)).toBe(400);
      expect(r.json().error.code).toBe("VALIDATION_ERROR");
    }
  });
  it("caps open challenges per address", async () => {
    const c = await makeCtx({ MAX_OPEN_NONCES_PER_ADDRESS: "3" });
    try {
      const s = await makeSigner();
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await requestNonce(c.app, s.address)).statusCode);
      expect(codes).toEqual([200, 200, 200, 429, 429]);
      expect((await requestNonce(c.app, s.address)).json().error.code).toBe("TOO_MANY_CHALLENGES");
    } finally { await c.close(); }
  });
  it("only cleans up long-dead challenges, never other tables", async () => {
    await ctx.pool.query("INSERT INTO auth_nonces (nonce, chain, address, issued_at, expires_at, message, domain, chain_id) VALUES ($1,'solana','x',now() - interval '3 days', now() - interval '3 days' + interval '5 minutes','m','d','c')", ["Z".repeat(32)]);
    const before = await counts();
    await requestNonce(ctx.app, (await makeSigner()).address);
    expect((await ctx.pool.query("SELECT 1 FROM auth_nonces WHERE nonce = $1", ["Z".repeat(32)])).rowCount).toBe(0);
    expect(await counts()).toEqual(before);
  });
});

describe("valid sign-in", () => {
  it("verifies, creates user + verified wallet + session, sets an HttpOnly cookie, never returns the token", async () => {
    const s = await makeSigner();
    const before = await counts();
    const { res, ch } = await signIn(ctx.app, s);
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b).toMatchObject({ authenticated: true, wallet: { address: s.address, ownershipVerified: true, dataSource: "database" }, session: { authMethod: "wallet_signature" } });
    const token = cookieValue(res)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body).not.toContain(token);
    expect(JSON.stringify(b)).not.toMatch(/token/i);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(/pn_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Expires=/);
    expect(setCookie).not.toMatch(/Secure/i); // dev config only; see production test below
    expect(res.headers["cache-control"]).toBe("no-store");

    const after = await counts();
    expect(after).toEqual({ users: before.users + 1, wallets: before.wallets + 1, sessions: before.sessions + 1 });
    const w = (await ctx.pool.query("SELECT user_id, ownership_verified_at, data_source FROM wallets WHERE address = $1", [s.address])).rows[0];
    expect(w.ownership_verified_at).not.toBeNull();
    const sess = (await ctx.pool.query("SELECT user_id, wallet_id, auth_method FROM sessions WHERE id_hash = $1", [sha(token)])).rows[0];
    expect(sess).toMatchObject({ user_id: w.user_id, auth_method: "wallet_signature" });
    expect((await ctx.pool.query("SELECT consumed_at FROM auth_nonces WHERE nonce = $1", [ch.nonce])).rows[0].consumed_at).not.toBeNull();
  });
  it("the cookie authenticates later requests and /auth/session reports it", async () => {
    const s = await makeSigner();
    const { res } = await signIn(ctx.app, s);
    const cookies = { pn_session: cookieValue(res)! };
    const me = await ctx.app.inject({ url: "/api/auth/session", cookies });
    expect(me.json()).toMatchObject({ authenticated: true, wallet: { address: s.address }, session: { authMethod: "wallet_signature" } });
    const w = await ctx.app.inject({ url: "/api/wallets", cookies });
    expect(w.statusCode).toBe(200);
    expect(w.json().wallets.map((x: { address: string }) => x.address)).toEqual([s.address]);
  });
  it("a real user sees only their own data: demo wallets are 404, own wallet has no fabricated portfolio", async () => {
    const s = await makeSigner();
    const { res } = await signIn(ctx.app, s);
    const cookies = { pn_session: cookieValue(res)! };
    expect((await ctx.app.inject({ url: `/api/wallets/${DEMO_IDS.wallets.trading}`, cookies })).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: `/api/portfolio/${DEMO_IDS.wallets.trading}`, cookies })).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: `/api/portfolio/${res.json().wallet.id}`, cookies })).statusCode).toBe(404);
  });
});

describe("rejections: signatures, messages, nonces, wallets", () => {
  it("invalid signature (another key signed the right message)", async () => {
    const a = await makeSigner(), imposter = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    await expectRejected(await verify({ address: a.address, nonce: ch.nonce, message: ch.message, signature: await imposter.sign(ch.message) }), before);
  });
  it("valid key, but signed a different message", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    await expectRejected(await verify({ address: a.address, nonce: ch.nonce, message: ch.message, signature: await a.sign("something else entirely") }), before);
  });
  it("all-zero signature", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    await expectRejected(await verify({ address: a.address, nonce: ch.nonce, message: ch.message, signature: "A".repeat(86) + "==" }), before);
  });
  it("modified message contents fail even if the attacker signs the modified text with the right key", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    const tampered = ch.message.replace(SIGN_IN_STATEMENT, "Transfer everything to the attacker.");
    expect(tampered).not.toBe(ch.message);
    await expectRejected(await verify({ address: a.address, nonce: ch.nonce, message: tampered, signature: await a.sign(tampered) }), before);
  });
  it("a message that differs from the issued challenge is rejected even when the signature is valid for the ORIGINAL challenge", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    const tampered = ch.message.replace("Version: 1", "Version: 2");
    await expectRejected(await verify({ address: a.address, nonce: ch.nonce, message: tampered, signature: await a.sign(ch.message) }), before);
  });
  it("message not issued by the server (self-built, well formed, unknown nonce text) fails", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    const own = buildSignInMessage({ ...parseSignInMessage(ch.message)!, nonce: "Q".repeat(32) });
    await expectRejected(await verify({ address: a.address, nonce: "Q".repeat(32), message: own, signature: await a.sign(own) }), before);
  });
  it("modified nonce fails and does not burn the real challenge", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    await expectRejected(await verify({ address: a.address, nonce: flip(ch.nonce), message: ch.message, signature: await a.sign(ch.message) }), before);
    const ok = await verify({ address: a.address, nonce: ch.nonce, message: ch.message, signature: await a.sign(ch.message) });
    expect(ok.statusCode).toBe(200);
  });
  it("modified wallet address in the request fails (nonce is bound to the address it was issued for)", async () => {
    const a = await makeSigner(), b = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    await expectRejected(await verify({ address: b.address, nonce: ch.nonce, message: ch.message, signature: await a.sign(ch.message) }), before);
    expect((await ctx.pool.query("SELECT consumed_at FROM auth_nonces WHERE nonce = $1", [ch.nonce])).rows[0].consumed_at).toBeNull();
  });
  it("a nonce generated for wallet A cannot authenticate wallet B", async () => {
    const a = await makeSigner(), b = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    // B signs A's challenge and claims to be B
    await expectRejected(await verify({ address: b.address, nonce: ch.nonce, message: ch.message, signature: await b.sign(ch.message) }), before);
    // B rewrites the message for its own address but reuses A's nonce
    const forged = buildSignInMessage({ ...parseSignInMessage(ch.message)!, address: b.address });
    await expectRejected(await verify({ address: b.address, nonce: ch.nonce, message: forged, signature: await b.sign(forged) }), before);
  });
  it("a signature from wallet A cannot authenticate wallet B", async () => {
    const a = await makeSigner(), b = await makeSigner();
    const chB = await challengeFor(b);
    const before = await counts();
    await expectRejected(await verify({ address: b.address, nonce: chB.nonce, message: chB.message, signature: await a.sign(chB.message) }), before);
  });
  it("replay: the same valid request cannot be used twice", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const body = { address: a.address, nonce: ch.nonce, message: ch.message, signature: await a.sign(ch.message) };
    expect((await verify(body)).statusCode).toBe(200);
    const before = await counts();
    await expectRejected(await verify(body), before);
    await expectRejected(await verify(body), before);
  });
  it("one attempt per challenge: a failed attempt burns the nonce, so a captured nonce cannot be retried", async () => {
    const a = await makeSigner(), imposter = await makeSigner();
    const ch = await challengeFor(a);
    const bad = await verify({ address: a.address, nonce: ch.nonce, message: ch.message, signature: await imposter.sign(ch.message) });
    expect(bad.statusCode).toBe(401);
    const before = await counts();
    await expectRejected(await verify({ address: a.address, nonce: ch.nonce, message: ch.message, signature: await a.sign(ch.message) }), before);
  });
  it("expired nonce fails", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    await ctx.pool.query("UPDATE auth_nonces SET issued_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes' WHERE nonce = $1", [ch.nonce]);
    const before = await counts();
    await expectRejected(await verify({ address: a.address, nonce: ch.nonce, message: ch.message, signature: await a.sign(ch.message) }), before);
  });
  it("a nonce that was never issued fails", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    await expectRejected(await verify({ address: a.address, nonce: "N".repeat(32), message: ch.message, signature: await a.sign(ch.message) }), before);
  });
  it("garbage message text fails (nonce burned)", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const before = await counts();
    await expectRejected(await verify({ address: a.address, nonce: ch.nonce, message: "please sign this", signature: await a.sign("please sign this") }), before);
  });
  it("malformed signatures are rejected at validation and do not burn the nonce", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const good = await a.sign(ch.message);
    const base58ish = "5".repeat(88);
    for (const signature of ["", "abc", "A".repeat(87), "A".repeat(88), good.slice(0, -2), good + "AA", base58ish, "!".repeat(86) + "==", 12345]) {
      const r = await verify({ address: a.address, nonce: ch.nonce, message: ch.message, signature });
      expect(r.statusCode, String(signature).slice(0, 20)).toBe(400);
      expect(r.json().error.code).toBe("VALIDATION_ERROR");
    }
    expect((await verify({ address: a.address, nonce: ch.nonce, message: ch.message, signature: good })).statusCode).toBe(200);
  });
  it("malformed bodies fail validation", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const sig = await a.sign(ch.message);
    for (const payload of [{}, { address: a.address }, { address: a.address, nonce: ch.nonce, message: "", signature: sig }, { address: a.address, nonce: ch.nonce, message: "x".repeat(1025), signature: sig }, { address: a.address, nonce: "short", message: ch.message, signature: sig }, { address: "bad", nonce: ch.nonce, message: ch.message, signature: sig }, { address: a.address, nonce: ch.nonce, message: ch.message, signature: sig, extra: true }]) {
      expect((await verify(payload)).statusCode, JSON.stringify(payload).slice(0, 60)).toBe(400);
    }
  });
  it("failure responses are uniform (do not reveal which check failed)", async () => {
    const a = await makeSigner();
    const ch = await challengeFor(a);
    const r1 = await verify({ address: a.address, nonce: "N".repeat(32), message: ch.message, signature: await a.sign(ch.message) });
    const r2 = await verify({ address: a.address, nonce: ch.nonce, message: "nope", signature: await a.sign("nope") });
    expect(r1.body).toBe(r2.body);
  });
});

describe("users and wallets in the database", () => {
  it("repeated authentication of one wallet never duplicates the user or wallet", async () => {
    const s = await makeSigner();
    const first = await signIn(ctx.app, s);
    const before = await counts();
    const verifiedAt = (await ctx.pool.query("SELECT ownership_verified_at FROM wallets WHERE address = $1", [s.address])).rows[0].ownership_verified_at;
    for (let i = 0; i < 3; i++) expect((await signIn(ctx.app, s)).res.statusCode).toBe(200);
    const after = await counts();
    expect(after.users).toBe(before.users);
    expect(after.wallets).toBe(before.wallets);
    expect(after.sessions).toBe(before.sessions + 3);
    const rows = (await ctx.pool.query("SELECT user_id, ownership_verified_at FROM wallets WHERE address = $1", [s.address])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].ownership_verified_at).toEqual(verifiedAt); // original timestamp preserved
    expect(first.res.json().user.id).toBe(rows[0].user_id);
  });
  it("concurrent first sign-ins for the same new wallet create exactly one user and one wallet", async () => {
    const s = await makeSigner();
    const before = await counts();
    const results = await Promise.all([signIn(ctx.app, s), signIn(ctx.app, s), signIn(ctx.app, s), signIn(ctx.app, s)]);
    expect(results.every((r) => r.res.statusCode === 200)).toBe(true);
    const after = await counts();
    expect(after.users).toBe(before.users + 1);
    expect(after.wallets).toBe(before.wallets + 1);
    expect(new Set(results.map((r) => r.res.json().user.id)).size).toBe(1);
  });
  it("different wallets get different users", async () => {
    const a = await signIn(ctx.app, await makeSigner()), b = await signIn(ctx.app, await makeSigner());
    expect(a.res.json().user.id).not.toBe(b.res.json().user.id);
  });
  it("the database enforces wallet uniqueness", async () => {
    const s = await makeSigner();
    await signIn(ctx.app, s);
    const u = await ctx.pool.query("INSERT INTO users DEFAULT VALUES RETURNING id");
    await expect(ctx.pool.query("INSERT INTO wallets (user_id, chain, address) VALUES ($1,'solana',$2)", [u.rows[0].id, s.address])).rejects.toThrow(/wallets_chain_address_key|duplicate key/);
  });
  it("a soft-removed wallet is re-activated for the same user on proof of control", async () => {
    const s = await makeSigner();
    const first = await signIn(ctx.app, s);
    await ctx.pool.query("UPDATE wallets SET removed_at = now() WHERE address = $1", [s.address]);
    const again = await signIn(ctx.app, s);
    expect(again.res.json().user.id).toBe(first.res.json().user.id);
    expect((await ctx.pool.query("SELECT removed_at FROM wallets WHERE address = $1", [s.address])).rows[0].removed_at).toBeNull();
  });
  it("demo wallets can never be verified or signed into", async () => {
    const s = await makeSigner();
    const u = await ctx.pool.query("INSERT INTO users (is_demo) VALUES (true) RETURNING id");
    await ctx.pool.query("INSERT INTO wallets (user_id, chain, address, data_source) VALUES ($1,'solana',$2,'demo')", [u.rows[0].id, s.address]);
    await expect(ctx.pool.query("UPDATE wallets SET ownership_verified_at = now() WHERE address = $1", [s.address])).rejects.toThrow(/wallets_demo_never_verified/);
    const before = await counts();
    const { res } = await signIn(ctx.app, s);
    expect(res.statusCode).toBe(401);
    expect(await counts()).toEqual(before);
  });
  it("a wallet-signature session must name its wallet (DB constraint)", async () => {
    const u = await ctx.pool.query("INSERT INTO users DEFAULT VALUES RETURNING id");
    await expect(createSession(ctx.pool, { userId: u.rows[0].id, walletId: null, authMethod: "wallet_signature", ttlHours: 1 })).rejects.toThrow(/sessions_wallet_session_has_wallet/);
  });
});

describe("sessions: logout, expiry, rotation", () => {
  it("logout revokes the session server-side, clears the cookie, and later requests fail", async () => {
    const s = await makeSigner();
    const { res } = await signIn(ctx.app, s);
    const token = cookieValue(res)!;
    const cookies = { pn_session: token };
    expect((await ctx.app.inject({ url: "/api/wallets", cookies })).statusCode).toBe(200);

    const out = await ctx.app.inject({ method: "POST", url: "/api/auth/logout", cookies, headers: browser });
    expect(out.statusCode).toBe(200);
    expect(out.json()).toEqual({ loggedOut: true });
    expect(String(out.headers["set-cookie"])).toMatch(/pn_session=;/);
    expect(String(out.headers["set-cookie"])).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await ctx.pool.query("SELECT revoked_at FROM sessions WHERE id_hash = $1", [sha(token)])).rows[0].revoked_at).not.toBeNull();

    expect((await ctx.app.inject({ url: "/api/wallets", cookies })).statusCode).toBe(401); // old cookie replayed after logout
    expect((await ctx.app.inject({ url: "/api/auth/session", cookies })).json().authenticated).toBe(false);
  });
  it("logout works with a bearer session and is idempotent without one", async () => {
    const t = (await ctx.app.inject({ method: "POST", url: "/api/auth/dev-session" })).json().token as string;
    expect((await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: bearer(t) })).statusCode).toBe(200);
    expect((await ctx.app.inject({ url: "/api/wallets", headers: bearer(t) })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: browser })).statusCode).toBe(200);
  });
  it("expired sessions are rejected", async () => {
    const { res } = await signIn(ctx.app, await makeSigner());
    const cookies = { pn_session: cookieValue(res)! };
    await ctx.pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id_hash = $1", [sha(cookies.pn_session)]);
    expect((await ctx.app.inject({ url: "/api/wallets", cookies })).statusCode).toBe(401);
    expect((await ctx.app.inject({ url: "/api/auth/session", cookies })).json().authenticated).toBe(false);
  });
  it("signing in rotates: the session this browser presented is revoked and a new one is issued", async () => {
    const s = await makeSigner();
    const first = await signIn(ctx.app, s);
    const oldToken = cookieValue(first.res)!;
    const second = await signIn(ctx.app, s, browser, `pn_session=${oldToken}`);
    const newToken = cookieValue(second.res)!;
    expect(newToken).not.toBe(oldToken);
    expect((await ctx.app.inject({ url: "/api/wallets", cookies: { pn_session: oldToken } })).statusCode).toBe(401);
    expect((await ctx.app.inject({ url: "/api/wallets", cookies: { pn_session: newToken } })).statusCode).toBe(200);
  });
  it("session TTL comes from configuration", async () => {
    const c = await makeCtx({ SESSION_TTL_HOURS: "2" });
    try {
      const { res } = await signIn(c.app, await makeSigner());
      const hours = (Date.parse(res.json().session.expiresAt) - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(1.9);
      expect(hours).toBeLessThan(2.01);
    } finally { await c.close(); }
  });
});

describe("CSRF / origin protection", () => {
  it("rejects state-changing requests from non-allowlisted origins (nonce, verify, logout)", async () => {
    const evil = { origin: "https://evil.example" };
    const s = await makeSigner();
    expect((await requestNonce(ctx.app, s.address, evil)).statusCode).toBe(403);
    expect((await verify({}, evil)).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: evil })).statusCode).toBe(403);
    expect((await requestNonce(ctx.app, s.address, { origin: "null" })).statusCode).toBe(403);
  });
  it("a cookie-authenticated state change without an Origin header is refused", async () => {
    const { res } = await signIn(ctx.app, await makeSigner());
    const cookies = { pn_session: cookieValue(res)! };
    const r = await ctx.app.inject({ method: "POST", url: "/api/auth/logout", cookies });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("ORIGIN_NOT_ALLOWED");
    expect((await ctx.app.inject({ url: "/api/wallets", cookies })).statusCode).toBe(200); // still logged in
  });
  it("a cross-site form post (cookie + evil origin) cannot create launches or donations", async () => {
    const { res } = await signIn(ctx.app, await makeSigner());
    const cookies = { pn_session: cookieValue(res)! };
    const r = await ctx.app.inject({ method: "POST", url: "/api/donations", cookies, headers: { origin: "https://evil.example" }, payload: {} });
    expect(r.statusCode).toBe(403);
  });
  it("non-browser clients without cookies or Origin still work", async () => {
    expect((await requestNonce(ctx.app, (await makeSigner()).address, {})).statusCode).toBe(200);
  });
});

describe("production configuration", () => {
  const prod = { NODE_ENV: "production", CORS_ORIGINS: "https://app.example.com", AUTH_MODE: "wallet" };
  it("uses a Secure, HttpOnly, SameSite=Strict __Host- cookie", async () => {
    const c = await makeCtx(prod);
    try {
      const s = await makeSigner();
      const { res } = await signIn(c.app, s, { origin: "https://app.example.com" });
      expect(res.statusCode).toBe(200);
      const sc = String(res.headers["set-cookie"]);
      expect(sc).toMatch(/^__Host-pn_session=/);
      expect(sc).toMatch(/Secure/);
      expect(sc).toMatch(/HttpOnly/i);
      expect(sc).toMatch(/SameSite=Strict/i);
      expect(sc).toMatch(/Path=\//);
      expect(sc).not.toMatch(/Domain=/i);
      const n = await requestNonce(c.app, s.address, { origin: "https://app.example.com" });
      expect(n.json()).toMatchObject({ domain: "app.example.com" });
      expect(parseSignInMessage(n.json().message)?.uri).toBe("https://app.example.com");
    } finally { await c.close(); }
  });
  it("rejects dev_insecure sessions and has no dev-session route, even if a session row exists", async () => {
    const c = await makeCtx(prod);
    try {
      const { token } = await createSession(c.pool, { userId: DEMO_IDS.user, walletId: null, authMethod: "dev_insecure", ttlHours: 1 });
      expect((await c.app.inject({ url: "/api/wallets", headers: bearer(token) })).statusCode).toBe(401);
      expect((await c.app.inject({ url: "/api/auth/session", headers: bearer(token) })).json().authenticated).toBe(false);
      expect((await c.app.inject({ method: "POST", url: "/api/auth/dev-session", headers: { origin: "https://app.example.com" } })).statusCode).toBe(404);
    } finally { await c.close(); }
  });
  it("wallet sessions still work in production", async () => {
    const c = await makeCtx(prod);
    try {
      const { res } = await signIn(c.app, await makeSigner(), { origin: "https://app.example.com" });
      expect((await c.app.inject({ url: "/api/wallets", cookies: { "__Host-pn_session": cookieValue(res, "__Host-pn_session")! } })).statusCode).toBe(200);
    } finally { await c.close(); }
  });
});
