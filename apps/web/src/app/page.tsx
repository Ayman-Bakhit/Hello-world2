import { COPY } from "@project-name/shared";
import { Badge } from "@/components/Badge";
import { ButtonLink } from "@/components/Button";
import { ConnectCta } from "@/components/ConnectCta";
import { DemoDataBanner } from "@/components/DemoDataBanner";
import { StatCard } from "@/components/StatCard";
import { formatUsd } from "@/lib/format";
import { portfolioTotals } from "@/lib/portfolio";
import { DEMO_DONATIONS, DEMO_PORTFOLIO, DEMO_TAX_RESERVE, DEMO_CREATOR_FEES_CENTS } from "@/mock";
import Link from "next/link";

export default function Landing() {
  const trading = portfolioTotals(DEMO_PORTFOLIO).valueCents;
  const giving = DEMO_DONATIONS.filter((d) => d.status === "confirmed").reduce((s, d) => s + d.amountCents, 0n);

  return (
    <div className="space-y-14">
      <section className="rise pt-4 sm:pt-10">
        <p className="eyebrow mb-4">Crypto financial OS · Transparent launchpad</p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          YOUR CRYPTO.
          <br />
          <span className="text-accent">ORGANIZED.</span>
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">
          Track your wallets. Prepare for taxes. Give automatically. Launch transparently.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <ConnectCta />
          <ButtonLink href="/discover" variant="secondary" className="px-5 py-2.5">EXPLORE LAUNCHES</ButtonLink>
        </div>
      </section>

      <section aria-labelledby="buckets">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="buckets" className="eyebrow !text-muted">YOUR MONEY, CLEARLY SEPARATED</h2>
          <DemoDataBanner variant="chip" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Trading" value={formatUsd(trading)} dotClass="bg-b-creator" sub="Across demo wallets" />
          <StatCard label="Tax" value={formatUsd(DEMO_TAX_RESERVE.reserveCents)} dotClass="bg-b-tax" sub="Estimated tax reserve" />
          <StatCard label="Giving" value={formatUsd(giving)} dotClass="bg-b-charity" sub="Confirmed donations" />
          <StatCard label="Creator" value={formatUsd(DEMO_CREATOR_FEES_CENTS)} dotClass="bg-b-protocol" sub="Creator fees" />
        </div>
        <p className="mt-2 text-xs text-faint">Sample values. After you connect a real wallet in a later release, these show your own data.</p>
      </section>

      <section className="rounded-xl border border-line bg-surface p-6 sm:p-8" aria-labelledby="vdt">
        <h2 id="vdt" className="text-xl font-semibold tracking-tight sm:text-2xl">Verify, Don&apos;t Trust.</h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            ["Your keys stay yours.", "Non-custodial by design. We never ask for, store, or see your keys."],
            ["Your transactions stay verifiable.", "Every number is meant to link to on-chain evidence you can check yourself."],
            ["We don't ask for seed phrases.", "Anyone who does is not us. Never enter a seed phrase on any website."],
          ].map(([t, d]) => (
            <li key={t} className="border-l border-accent/40 pl-4">
              <p className="text-sm font-semibold">{t}</p>
              <p className="mt-1 text-xs text-muted">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Two sides of the product">
        <div className="rounded-xl border border-line bg-surface p-6">
          <Badge tone="info">FINANCIAL OS</Badge>
          <h3 className="mt-3 text-lg font-semibold">Never lose track of what you may owe.</h3>
          <p className="mt-1.5 text-sm text-muted">Track realized gains, estimate tax exposure, and keep a dedicated reserve. Tax planning estimates are not tax advice.</p>
          <div className="mt-4 flex gap-4 text-xs font-semibold tracking-wider">
            <Link href="/portfolio" className="text-accent hover:underline">PORTFOLIO</Link>
            <Link href="/tax" className="text-accent hover:underline">TAX CENTER</Link>
            <Link href="/give" className="text-accent hover:underline">GIVE</Link>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6">
          <Badge tone="info">LAUNCHPAD</Badge>
          <h3 className="mt-3 text-lg font-semibold">Launch without hiding where the money goes.</h3>
          <p className="mt-1.5 text-sm text-muted">Define your fee split. Publish it. Let everyone verify it.</p>
          <div className="mt-4 flex gap-4 text-xs font-semibold tracking-wider">
            <Link href="/launch" className="text-accent hover:underline">CREATE TOKEN</Link>
            <Link href="/token/demo" className="text-accent hover:underline">SAMPLE PROOF PAGE</Link>
            <Link href="/trust" className="text-accent hover:underline">TRUST CENTER</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
