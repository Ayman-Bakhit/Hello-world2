import type { Metadata } from "next";
import { PublicLaunchProofScreen } from "@/components/screens/LaunchProofScreen";

export const metadata: Metadata = { title: "Token proof" };

export default function Page() {
  return <PublicLaunchProofScreen />;
}
