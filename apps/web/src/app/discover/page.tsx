import type { Metadata } from "next";
import { DiscoverScreen } from "@/components/screens/DiscoverScreen";

export const metadata: Metadata = { title: "Discover" };

export default function Page() {
  return <DiscoverScreen />;
}
