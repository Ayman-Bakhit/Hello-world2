import type { Metadata } from "next";
import { LaunchScreen } from "@/components/screens/LaunchScreen";

export const metadata: Metadata = { title: "Launch" };

export default function Page() {
  return <LaunchScreen />;
}
