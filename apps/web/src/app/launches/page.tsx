import type { Metadata } from "next";
import { PublicLaunchesScreen } from "@/components/screens/PublicLaunchesScreen";

export const metadata: Metadata = { title: "Public launch configurations" };

export default function Page() {
  return <PublicLaunchesScreen />;
}
