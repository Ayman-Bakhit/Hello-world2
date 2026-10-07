import type { Metadata } from "next";
import { DeploymentPlanScreen } from "@/components/screens/DeploymentPlanScreen";

export const metadata: Metadata = { title: "Deployment plan" };

export default function Page() {
  return <DeploymentPlanScreen />;
}
