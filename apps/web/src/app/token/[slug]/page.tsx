import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FEE_BUCKETS } from "@project-name/shared";
import { AllocationBar } from "@/components/AllocationBar";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { TransparencyStatus } from "@/components/DiscoverClient";
import { DemoDataBanner } from "@/components/DemoDataBanner";
import { ProofPanel, type ProofRow } from "@/components/ProofPanel";
import { RiskPanel, rowsForToken } from "@/components/RiskPanel";
import { StatCard } from "@/components/StatCard";
import { BUCKET_COLOR, BUCKET_LABEL } from "@/lib/feeDrafts";
import { formatCompactUsd, formatDate, formatDateTime, formatPercentBps, formatPrice, formatUsd, shortAddress } from "@/lib/format";
import { DEMO_TOKENS, tokenCharityGeneratedCents, tokenMoneyFlow } from "@/mock";

export function generateStaticParams() {
  return DEMO_TOKENS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = DEMO_TOKENS.find((x) => x.slug === slug);
  return { title: t ? `${t.name} (demo)` : "Token not found" };
}

export default async function TokenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = DEMO_TOKENS.find((x) => x.slug === slug);
  if (!t) notFound();

  const flow = tokenMoneyFlow(t);
  const proof: ProofRow[] = [
    { label: "Mint authority", value: t.mintAuthority === "disabled" ? "Disabled (reported by creator)" : "Held by creator (reported)", status: "DEMO" },
    { label: "Freeze authority", value: t.freezeAuthority === "disabled" ? "Disabled (reported by creator)" : "Held by creator (reported)", status: "DEMO" },
    { label: "Creator wallet", value: t.creatorAddress, status: "DEMO", mono: true },
    { label: "Liquidity", value: `${formatUsd(t.liquidityCents)} · ${t.liquidityLockDays ? `lock ${t.liquidityLockDays} days (reported)` : "no lock disclosed"}`, status: "NOT CONNECTED" },
    { label: "Admin status", value: t.adminPrivileges === "none" ? "No admin privileges reported" : "Fee configuration controlled by an admin (reported)", status: "NOT IMPLEMENTED" },
    { label: "Contract", value: t.contractAddress ?? "Not deployed. This is a demo token.", status: "NOT CONNECTED", mono: true },
  ];

  return (
    <div className="space-y-6">
      <div className="-mx-4 -mt-6 border-b border-warn/30 bg-warn/10 px-4 py-3 sm:-mx-6 sm:-mt-8 sm:px-6">
        <DemoDataBanner message="BLOCKCHAIN VERIFICATION NOT YET CONNECTED. Nothing on this page is verified on-chain." className="border-0 bg-transparent px-0 py-0 text-sm" />
      </div>

      <header className="rise flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-1.5">Token proof page</p>
          <h1 className="text-3xl font-semibold tracking-tight">{t.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="num font-mono">{t.symbol}</span>
            <TransparencyStatus token={t} />
            <Badge tone="demo">FICTIONAL TOKEN</Badge>
          </p>
        </div>
        <Link href="/discover" className="text-xs font-semibold tracking-wider text-muted hover:text-fg">← DISCOVER</Link>
      </header>
      <p className="max-w-2xl text-sm text-muted">{t.description}</p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Price" value={formatPrice(t.priceMicro)} />
        <StatCard label="Market cap" value={formatCompactUsd(t.marketCapCents)} />
        <StatCard label="Liquidity" value={formatCompactUsd(t.liquidityCents)} />
        <StatCard label="Volume 24h" value={formatCompactUsd(t.volume24hCents)} />
        <StatCard label="Holders" value={t.holders.toLocaleString("en-US")} />
        <StatCard label="Launch date" value={formatDate(t.launchedAt)} />
        <StatCard label="Creator" value={<span className="text-base">{t.creatorLabel}</span>} sub={<span className="num font-mono">{shortAddress(t.creatorAddress)}</span>} className="col-span-2" />
      </div>

      <Card title="MONEY FLOW" right={<Badge tone="demo">DEMO CONFIGURATION — ON-CHAIN ENFORCEMENT NOT IMPLEMENTED</Badge>}>
        <AllocationBar segments={FEE_BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], bps: t.feeSplit[b], colorClass: BUCKET_COLOR[b] }))} />
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {FEE_BUCKETS.map((b) => (
            <div key={b}>
              <p className="flex items-center gap-2 eyebrow"><span aria-hidden className={`h-2 w-2 rounded-sm ${BUCKET_COLOR[b]}`} />{BUCKET_LABEL[b]}</p>
              <p className="num mt-1.5 text-xl font-semibold">{formatUsd(flow[b])}</p>
              <p className="num text-xs text-muted">{formatPercentBps(t.feeSplit[b], { digits: 2 })} of fees</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-faint">
          Lifetime fees (demo): {formatUsd(t.lifetimeFeesCents)}. Split computed with the shared basis-point math. With a real
          deployment, each figure would link to the transactions that moved the funds.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProofPanel rows={proof} />
        <RiskPanel title="TRANSPARENCY DATA" rows={rowsForToken(t)} />
      </div>

      <Card title="Charity impact" right={<Badge tone="demo">DEMO DATA</Badge>}>
        <p className="eyebrow">Total generated for charity</p>
        <p className="num mt-1 text-3xl font-semibold">{formatUsd(tokenCharityGeneratedCents(t))}</p>
        <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div><dt className="eyebrow">Donations</dt><dd className="num mt-0.5">{t.charity.donations}</dd></div>
          <div><dt className="eyebrow">Charities supported</dt><dd className="num mt-0.5">{t.charity.charities}</dd></div>
          <div><dt className="eyebrow">Last donation</dt><dd className="num mt-0.5">{formatDateTime(t.charity.lastDonationAt)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-faint">Each donation would link to its transaction. Demo entries have no transaction.</p>
      </Card>

      <p className="text-center text-sm font-semibold tracking-wide text-muted">Don&apos;t trust us. Verify it.</p>
    </div>
  );
}
