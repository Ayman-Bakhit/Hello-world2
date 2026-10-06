import type { Metadata } from "next";
import { LaunchConfigurationScreen } from "@/components/screens/LaunchScreen";

export const metadata: Metadata = { title: "Launch configuration" };

export default function Page() {
  return <LaunchConfigurationScreen />;
}
