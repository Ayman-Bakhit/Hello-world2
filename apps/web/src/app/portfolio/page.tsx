import type { Metadata } from "next";
import { PortfolioScreen } from "@/components/screens/PortfolioScreen";

export const metadata: Metadata = { title: "Portfolio" };

export default function Page() {
  return <PortfolioScreen />;
}
