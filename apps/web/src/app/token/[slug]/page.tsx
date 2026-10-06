import type { Metadata } from "next";
import { DEMO_TOKENS } from "@project-name/shared";
import { TokenProofScreen } from "@/components/screens/TokenProofScreen";

/** Static params/metadata come from the shared demo fixtures; the page body is loaded through the API client. */
export function generateStaticParams() {
  return DEMO_TOKENS.map((t) => ({ slug: t.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = DEMO_TOKENS.find((x) => x.id === slug);
  return { title: t ? `${t.name} (demo)` : "Token proof" };
}

export default async function TokenPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <TokenProofScreen slug={slug} />;
}
