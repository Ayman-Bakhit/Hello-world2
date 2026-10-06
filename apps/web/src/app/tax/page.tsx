import type { Metadata } from "next";
import { TaxScreen } from "@/components/screens/TaxScreen";

export const metadata: Metadata = { title: "Tax Center" };

export default function Page() {
  return <TaxScreen />;
}
