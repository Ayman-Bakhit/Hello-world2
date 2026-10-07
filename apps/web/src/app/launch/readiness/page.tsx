import type { Metadata } from "next";
import { ReadinessScreen } from "@/components/screens/ReadinessScreen";

export const metadata: Metadata = { title: "Deployment readiness" };

export default function Page() {
  return <ReadinessScreen />;
}
