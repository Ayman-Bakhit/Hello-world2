import { ApiError } from "../errors";

/**
 * Bounds tax-calculation work (each one reads up to TAX_MAX_TRANSACTIONS rows). Excess is refused immediately with a
 * clear error; nothing queues, so a burst cannot pile up unbounded work. In-memory: per process.
 */
export class TaxGate {
  private active = 0;
  private readonly perUser = new Map<string, number>();
  constructor(private readonly max: number, private readonly maxPerUser: number) {}

  async run<T>(userId: string, f: () => Promise<T>): Promise<T> {
    const mine = this.perUser.get(userId) ?? 0;
    if (mine >= this.maxPerUser) throw new ApiError(429, "TAX_IN_PROGRESS", "Several tax calculations for your account are already running. Wait for them to finish.");
    if (this.active >= this.max) throw new ApiError(503, "TAX_BUSY", "The server is busy calculating other tax reports. Try again shortly.");
    this.active++;
    this.perUser.set(userId, mine + 1);
    try {
      return await f();
    } finally {
      this.active--;
      const left = (this.perUser.get(userId) ?? 1) - 1;
      if (left <= 0) this.perUser.delete(userId);
      else this.perUser.set(userId, left);
    }
  }
}
