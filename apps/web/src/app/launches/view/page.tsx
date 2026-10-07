import type { Metadata } from "next";
import { PublicLaunchScreen } from "@/components/screens/PublicLaunchesScreen";

export const metadata: Metadata = { title: "Launch configuration" };

export default function Page() {
  return <PublicLaunchScreen />;
}
