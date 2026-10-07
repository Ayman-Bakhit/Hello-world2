import type { Metadata } from "next";
import { LaunchProofScreen } from "@/components/screens/LaunchProofScreen";

export const metadata: Metadata = { title: "Token proof" };

export default function Page() {
  return <LaunchProofScreen />;
}
