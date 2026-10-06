import type { Metadata } from "next";
import { GiveScreen } from "@/components/screens/GiveScreen";

export const metadata: Metadata = { title: "Give" };

export default function Page() {
  return <GiveScreen />;
}
