/** A price is a claim from a named source at a time. Absence of a price is represented by absence, never by zero. */
export interface PriceQuote {
  /** "native" for SOL, otherwise a mint address */
  asset: string;
  /** micro-USD per whole token (1 USD = 1,000,000) */
  priceMicroUsd: bigint;
  observedAt: Date;
  source: string;
}

export interface PriceProvider {
  readonly name: string;
  /** Returns quotes only for assets it can actually price. Unknown assets are simply absent from the map. */
  getPrices(assets: string[]): Promise<Map<string, PriceQuote>>;
}

/** Default: no price source configured. Every asset stays "PRICE DATA UNAVAILABLE". */
export class NullPriceProvider implements PriceProvider {
  readonly name = "none";
  async getPrices(): Promise<Map<string, PriceQuote>> {
    return new Map();
  }
}

/** "123.456789" -> 123_456_789n micro-USD without going through a float. Extra digits are truncated. */
export function decimalToMicroUsd(s: string): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{1,18}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0").slice(0, 6));
}

/**
 * SOL/USD from CoinGecko's public "simple price" endpoint. SOL only: SPL tokens are never priced by guesswork.
 * The number is read from the raw response text so no float is involved. Mainnet only (devnet SOL has no market value).
 */
export class CoinGeckoPriceProvider implements PriceProvider {
  readonly name = "coingecko";
  constructor(private readonly o: { baseUrl: string; apiKey?: string | undefined; timeoutMs: number; fetchImpl?: typeof fetch }) {}

  async getPrices(assets: string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    if (!assets.includes("native")) return out;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
    try {
      const f = this.o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
      const res = await f(`${this.o.baseUrl.replace(/\/$/, "")}/simple/price?ids=solana&vs_currencies=usd`, {
        headers: { accept: "application/json", ...(this.o.apiKey ? { "x-cg-demo-api-key": this.o.apiKey } : {}) },
        signal: ctl.signal,
        redirect: "error",
      });
      if (!res.ok) return out;
      const text = await res.text();
      if (text.length > 4096) return out;
      const m = /"solana"\s*:\s*\{\s*"usd"\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*\}/.exec(text);
      const micro = m ? decimalToMicroUsd(m[1]!) : null;
      if (micro !== null && micro > 0n) out.set("native", { asset: "native", priceMicroUsd: micro, observedAt: new Date(), source: this.name });
    } catch {
      /* unreachable provider = no price. Never an error the user must debug. */
    } finally {
      clearTimeout(timer);
    }
    return out;
  }
}

/** Test double: fixed prices, optionally failing. */
export class FakePriceProvider implements PriceProvider {
  readonly name = "fake";
  constructor(public prices: Record<string, bigint> = {}, public now: () => Date = () => new Date()) {}
  async getPrices(assets: string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    for (const a of assets) if (this.prices[a] !== undefined) out.set(a, { asset: a, priceMicroUsd: this.prices[a]!, observedAt: this.now(), source: this.name });
    return out;
  }
}
