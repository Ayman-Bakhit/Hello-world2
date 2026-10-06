/**
 * Sign-in message (version 1). Modeled on "Sign In With Solana" / EIP-4361: plain ASCII text,
 * "\n" line endings, no trailing newline. The SERVER builds it and stores the exact text with the
 * nonce; verification compares the client's copy byte-for-byte against the stored text and then
 * verifies the ed25519 signature over those bytes. The wallet displays this text to the user.
 *
 *   {domain} wants you to sign in with your Solana account:
 *   {address}
 *
 *   Sign in to PROJECT_NAME. This does not send a transaction or move funds.
 *
 *   URI: {uri}
 *   Version: 1
 *   Chain ID: {chainId}
 *   Nonce: {nonce}
 *   Issued At: {issuedAt}
 *   Expiration Time: {expirationTime}
 *
 * It is a login proof, not a transaction: it cannot be submitted to any chain.
 */
export const APP_NAME = "PROJECT_NAME";
export const SIGN_IN_STATEMENT = `Sign in to ${APP_NAME}. This does not send a transaction or move funds.`;
export const SIGN_IN_MESSAGE_VERSION = "1";
export const SIGN_IN_WALLET_NOTICE = `Sign this message to securely authenticate with ${APP_NAME}. This does not send a transaction or move funds.`;

export interface SignInMessageFields {
  /** host[:port] of the web app the user is signing in to */
  domain: string;
  /** origin of the web app, e.g. https://app.example.com */
  uri: string;
  /** base58 Solana address being authenticated */
  address: string;
  /** e.g. solana:mainnet, solana:devnet */
  chainId: string;
  /** server-generated, 32 chars of [A-Za-z0-9_-] (192 bits) */
  nonce: string;
  /** ISO-8601 UTC with milliseconds */
  issuedAt: string;
  expirationTime: string;
}

const RE = {
  domain: /^[A-Za-z0-9.-]+(:\d{1,5})?$/,
  uri: /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/,
  address: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  chainId: /^solana:[a-z0-9-]{3,20}$/,
  nonce: /^[A-Za-z0-9_-]{32}$/,
  time: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
} as const;

export const NONCE_PATTERN = RE.nonce;
export const BASE58_ADDRESS_PATTERN = RE.address;

function check(f: SignInMessageFields): void {
  const bad =
    !RE.domain.test(f.domain) ? "domain"
    : !RE.uri.test(f.uri) ? "uri"
    : !RE.address.test(f.address) ? "address"
    : !RE.chainId.test(f.chainId) ? "chainId"
    : !RE.nonce.test(f.nonce) ? "nonce"
    : !RE.time.test(f.issuedAt) ? "issuedAt"
    : !RE.time.test(f.expirationTime) ? "expirationTime"
    : null;
  if (bad) throw new Error(`Invalid sign-in message field: ${bad}`);
}

export function buildSignInMessage(f: SignInMessageFields): string {
  check(f);
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.address,
    "",
    SIGN_IN_STATEMENT,
    "",
    `URI: ${f.uri}`,
    `Version: ${SIGN_IN_MESSAGE_VERSION}`,
    `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt}`,
    `Expiration Time: ${f.expirationTime}`,
  ].join("\n");
}

/** Strict parse: returns the fields only if the text is exactly what buildSignInMessage would produce. */
export function parseSignInMessage(message: string): SignInMessageFields | null {
  const lines = message.split("\n");
  if (lines.length !== 11) return null;
  const suffix = " wants you to sign in with your Solana account:";
  const l0 = lines[0] ?? "";
  if (!l0.endsWith(suffix)) return null;
  const take = (line: string | undefined, prefix: string) => (line?.startsWith(prefix) ? line.slice(prefix.length) : null);
  const fields = {
    domain: l0.slice(0, -suffix.length),
    address: lines[1] ?? "",
    uri: take(lines[5], "URI: "),
    chainId: take(lines[7], "Chain ID: "),
    nonce: take(lines[8], "Nonce: "),
    issuedAt: take(lines[9], "Issued At: "),
    expirationTime: take(lines[10], "Expiration Time: "),
  };
  if (Object.values(fields).some((v) => v === null)) return null;
  try {
    const f = fields as SignInMessageFields;
    return buildSignInMessage(f) === message ? f : null;
  } catch {
    return null;
  }
}

export interface ChallengeCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Client-side sanity check before asking a wallet to sign: the challenge must be a well-formed
 * sign-in message for THIS address and THIS app origin, with the nonce the server returned and a
 * sane validity window. Protects users from signing something unexpected.
 */
export function checkChallenge(
  c: { message: string; nonce: string; expiresAt: string },
  expected: { address: string; origin: string; now?: Date },
): ChallengeCheck {
  const f = parseSignInMessage(c.message);
  if (!f) return { ok: false, reason: "Challenge is not a valid sign-in message" };
  if (f.address !== expected.address) return { ok: false, reason: "Challenge is for a different wallet" };
  if (f.nonce !== c.nonce) return { ok: false, reason: "Challenge nonce mismatch" };
  if (f.uri !== expected.origin) return { ok: false, reason: "Challenge is for a different site" };
  if (f.expirationTime !== c.expiresAt) return { ok: false, reason: "Challenge expiry mismatch" };
  const now = (expected.now ?? new Date()).getTime();
  const issued = Date.parse(f.issuedAt);
  const exp = Date.parse(f.expirationTime);
  if (!(exp > issued) || exp - issued > 15 * 60_000) return { ok: false, reason: "Challenge validity window is invalid" };
  if (exp <= now) return { ok: false, reason: "Challenge already expired" };
  return { ok: true };
}
