import type { Metadata } from "next";
import { COPY } from "@project-name/shared";
import { Badge } from "@/components/Badge";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Trust Center" };

const SOON = "COMING IN THE ON-CHAIN IMPLEMENTATION";

interface Section {
  id: string;
  title: string;
  status: "design" | "soon" | "info";
  body: string[];
}

const SECTIONS: Section[] = [
  { id: "funds", title: "How funds work", status: "design", body: [
    "Design intent: non-custodial. You hold your keys, your wallet signs every transaction, and the platform has no authority to move your funds.",
    "This demo build holds no funds, sends no transactions, and connects to no blockchain.",
  ] },
  { id: "tax", title: "How tax estimates work", status: "info", body: [
    "Estimates come from a tested calculation engine: cost-basis lots (FIFO, LIFO or HIFO), short versus long-term holding periods, and tax rates you supply. Nothing is hardcoded.",
    "They are planning estimates, not your tax liability. Brackets, NIIT, loss limits, state rules, and income treatment are not modeled yet. Consult a qualified tax professional.",
  ] },
  { id: "charity", title: "How charity works", status: "design", body: [
    "Charities are verified by admin review before they can receive funds, and each charity wallet is verified separately. A wallet claiming to be a charity is never trusted by default.",
    `${COPY.donation} ${COPY.donationNote}`,
  ] },
  { id: "creator-fees", title: "How creator fees work", status: "design", body: [
    "Creators define a split across Creator, Tax Reserve, Charity, and Protocol in basis points. The total must be exactly 10,000 (100%).",
    "A split will only be labeled IMMUTABLE if the contract truly cannot change it; otherwise it will read ADMIN CONTROLLED. No contract exists yet, so no split is enforced today.",
  ] },
  { id: "contracts", title: "Contracts", status: "soon", body: ["No contracts are deployed. Addresses and source links will be listed here."] },
  { id: "audits", title: "Audits", status: "soon", body: ["No audit has been performed. Reports will be published here before any mainnet use of user funds."] },
  { id: "treasuries", title: "Treasuries", status: "soon", body: ["The protocol treasury address, balance, revenue, and expenses will be public. No hidden wallets."] },
  { id: "security", title: "Security", status: "soon", body: [
    "We never ask for seed phrases or private keys. Never enter them anywhere.",
    "Wallet sign-in, rate limiting, CSRF protection, and transaction simulation are planned and not implemented in this build. See the threat model in the repository.",
  ] },
  { id: "privacy", title: "Privacy", status: "design", body: [
    "Wallet addresses are public blockchain data. Tax estimates and portfolio details will never be public. Public token pages show only what creators intentionally disclose.",
  ] },
  { id: "risks", title: "Risks", status: "info", body: [
    "Crypto assets can lose all value. Tokens launched here can be illiquid, concentrated, or abandoned. Transparency data shows what is disclosed, not whether a token is safe. Smart contracts can have bugs even when audited.",
  ] },
  { id: "legal", title: "Legal", status: "info", body: [
    "Nothing here is financial, legal, or tax advice. Legal review (money transmission, securities, charitable solicitation, tax reporting, sanctions) is required before any public launch and has not been completed.",
  ] },
];

export default function TrustPage() {
  return (
    <div>
      <PageHeader eyebrow="Trust" title="Trust Center" subtitle="Verify, don't trust. What is real today, what is design intent, and what is not built." />
      <nav aria-label="Sections" className="mb-6 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border border-line-strong px-3 py-1 text-xs text-muted hover:text-fg">{s.title}</a>
        ))}
      </nav>
      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-20 rounded-lg border border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold">{s.title}</h2>
              {s.status === "soon" ? <Badge tone="demo">{SOON}</Badge> : s.status === "design" ? <Badge tone="neutral">DESIGN INTENT</Badge> : null}
            </div>
            <div className="mt-2 space-y-2 text-sm text-muted">
              {s.body.map((p) => <p key={p}>{p}</p>)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
