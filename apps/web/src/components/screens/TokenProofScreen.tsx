"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FEE_BUCKETS, type TokenProof, type TokenSummary } from "@project-name/shared";
import { api } from "@/lib/api/client";
import { useResource } from "@/lib/api/useResource";
import { BUCKET_COLOR, BUCKET_LABEL } from "@/lib/feeDrafts";
import { formatCompactUsd, formatDate, formatDateTime, formatPercentBps, formatPrice, formatUsd, shortAddress } from "@/lib/format";
import { DEMO_PROOF_BANNER, transparencyBadge } from "@/lib/transparency";
import { AllocationBar } from "../AllocationBar";
import { Badge } from "../Badge";
import { Card } from "../Card";
import { DataSourceBadge } from "../DataSource";
import { DemoDataBanner } from "../DemoDataBanner";
import { ProofPanel, type ProofRow } from "../ProofPanel";
import { RiskPanel, type Row } from "../RiskPanel";
import { ResourceView } from "../states";
import { StatCard } from "../StatCard";

const ctrl = (v: "disabled" | "creator") => (v === "disabled" ? "Disabled" : "Held by creator");

/** Rows for the proof panel, derived only from the API payload. Statuses say what is NOT verified. */
export function proofRows(p: TokenProof): ProofRow[] {
  return [
    { label: "Mint authority", value: `${ctrl(p.mintAuthority)} (reported)`, status: "DEMO" },
    { label: "Freeze authority", value: `${ctrl(p.freezeAuthority)} (reported)`, status: "DEMO" },
    { label: "Creator wallet", value: p.creatorWallet.address, status: "DEMO", mono: true },
    { label: "Liquidity", value: `${formatUsd(BigInt(p.liquidity.amountCents))} · ${p.liquidity.lockDays ? `lock ${p.liquidity.lockDays} days (reported)` : "no lock disclosed"}`, status: "NOT CONNECTED" },
    { label: "Admin status", value: p.adminStatus, status: "NOT IMPLEMENTED" },
    { label: "Contract", value: p.contractAddress ?? "Not deployed. This is a demo token.", status: "NOT CONNECTED", mono: true },
  ];
}

export function riskRows(p: TokenProof, s: TokenSummary | null): Row[] {
  const conc = s?.creatorConcentrationBps;
  return [
    { label: "Mint authority", value: ctrl(p.mintAuthority), level: p.mintAuthority === "disabled" ? "ok" : "watch" },
    { label: "Freeze authority", value: ctrl(p.freezeAuthority), level: p.freezeAuthority === "disabled" ? "ok" : "watch" },
    { label: "Creator allocation", value: conc === undefined ? "Not provided" : formatPercentBps(conc), level: conc !== undefined && conc > 2000 ? "watch" : "info" },
    { label: "Top 10 concentration", value: "Not provided by the API", level: "info" },
    { label: "Liquidity", value: `${formatUsd(BigInt(p.liquidity.amountCents))}${p.liquidity.lockDays ? ` · lock ${p.liquidity.lockDays}d` : " · no lock disclosed"}`, level: p.liquidity.lockDays ? "info" : "watch" },
    { label: "Admin privileges", value: p.adminStatus, level: "info" },
  ];
}

/** Pure view. The verification wording is decided by the API's verifiedOnChain flag, not by this component. */
export function TokenProofView({ proof, summary }: { proof: TokenProof; summary: TokenSummary | null }) {
  const reported = Object.values(proof.transparencyChecksReported).filter(Boolean).length;
  const total = Object.keys(proof.transparencyChecksReported).length;
  const badge = transparencyBadge({ reported, total, verifiedOnChain: proof.verifiedOnChain, dataSource: proof.dataSource });
  return (
    <div className="space-y-6">
      {!proof.verifiedOnChain ? (
        <div className="-mx-4 -mt-6 border-b border-warn/30 bg-warn/10 px-4 py-3 sm:-mx-6 sm:-mt-8 sm:px-6">
          <DemoDataBanner message={`${proof.dataSource === "demo" ? "" : "UNVERIFIED. "}${DEMO_PROOF_BANNER}`} className="border-0 bg-transparent px-0 py-0 text-sm" />
        </div>
      ) : null}

      <header className="rise flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-1.5">Token proof page</p>
          <h1 className="text-3xl font-semibold tracking-tight">{proof.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="num font-mono">{proof.symbol}</span>
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <DataSourceBadge dataSource={proof.dataSource} verifiedOnChain={proof.verifiedOnChain} />
            {proof.dataSource === "demo" ? <Badge tone="demo">FICTIONAL TOKEN</Badge> : null}
          </p>
        </div>
        <Link href="/discover" className="text-xs font-semibold tracking-wider text-muted hover:text-fg">← DISCOVER</Link>
      </header>
      <p className="max-w-2xl text-sm text-muted">{proof.notice}</p>

      {summary ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Price" value={formatPrice(BigInt(summary.priceMicroUsd))} />
          <StatCard label="Market cap" value={formatCompactUsd(BigInt(summary.marketCapCents))} />
          <StatCard label="Liquidity" value={formatCompactUsd(BigInt(summary.liquidityCents))} />
          <StatCard label="Volume 24h" value={formatCompactUsd(BigInt(summary.volume24hCents))} />
          <StatCard label="Holders" value={summary.holders.toLocaleString("en-US")} />
          <StatCard label="Launch date" value={formatDate(summary.launchedAt)} />
          <StatCard label="Creator" value={<span className="text-base">{proof.creatorWallet.label}</span>} sub={<span className="num font-mono">{shortAddress(proof.creatorWallet.address)}</span>} className="col-span-2" />
        </div>
      ) : null}

      <Card title="MONEY FLOW" right={<Badge tone="demo">DEMO CONFIGURATION — ON-CHAIN ENFORCEMENT NOT IMPLEMENTED</Badge>}>
        <AllocationBar segments={FEE_BUCKETS.map((b) => ({ label: BUCKET_LABEL[b], bps: proof.feeSplit[b], colorClass: BUCKET_COLOR[b] }))} />
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {FEE_BUCKETS.map((b) => (
            <div key={b}>
              <p className="flex items-center gap-2 eyebrow"><span aria-hidden className={`h-2 w-2 rounded-sm ${BUCKET_COLOR[b]}`} />{BUCKET_LABEL[b]}</p>
              <p className="num mt-1.5 text-xl font-semibold">{formatUsd(BigInt(proof.moneyFlowCents[b]))}</p>
              <p className="num text-xs text-muted">{formatPercentBps(proof.feeSplit[b], { digits: 2 })} of fees</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-faint">
          {proof.feeSplit.label}. Enforcement: {proof.feeSplit.enforcement.replace("_", " ")}. Mutability: {proof.feeSplit.mutability.toLowerCase()} (no contract exists). Each figure would link to the transactions that moved the funds.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProofPanel rows={proofRows(proof)} />
        <RiskPanel title="TRANSPARENCY DATA" rows={riskRows(proof, summary)} />
      </div>

      <Card title="Charity impact" right={<DataSourceBadge dataSource={proof.dataSource} />}>
        <p className="eyebrow">Total generated for charity (configured split, demo)</p>
        <p className="num mt-1 text-3xl font-semibold">{formatUsd(BigInt(proof.charity.totalGeneratedCents))}</p>
        <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div><dt className="eyebrow">Donations</dt><dd className="num mt-0.5">{proof.charity.donations}</dd></div>
          <div><dt className="eyebrow">Charities supported</dt><dd className="num mt-0.5">{proof.charity.charitiesSupported}</dd></div>
          <div><dt className="eyebrow">Last donation</dt><dd className="num mt-0.5">{formatDateTime(proof.charity.lastDonationAt)}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-faint">Evidence links: {proof.evidence.length === 0 ? "none (no on-chain evidence exists for this token)" : proof.evidence.length}</p>
      </Card>

      <p className="text-center text-sm font-semibold tracking-wide text-muted">Don&apos;t trust us. Verify it.</p>
    </div>
  );
}

export function TokenProofScreen({ slug }: { slug: string }): ReactNode {
  const proof = useResource(`proof:${slug}`, () => api.getTokenProof(slug));
  const tokens = useResource("tokens", () => api.getTokens());
  return (
    <ResourceView resource={proof} loadingLabel="Loading token proof">
      {(p) => <TokenProofView proof={p} summary={tokens.status === "ok" ? (tokens.data.tokens.find((t) => t.id === slug) ?? null) : null} />}
    </ResourceView>
  );
}
