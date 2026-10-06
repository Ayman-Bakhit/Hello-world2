import type { Metadata } from "next";
import { TaxReserveScreen } from "@/components/screens/TaxReserveScreen";

export const metadata: Metadata = { title: "Tax Reserve" };

export default function Page() {
  return <TaxReserveScreen />;
}
