import type { Metadata } from "next";
import { ConnectionsScreen } from "@/features/social/components/connections-screen";
export const metadata: Metadata = {
  title: "Connections | Veya",
  robots: { index: false, follow: false },
};
export default function ConnectionsPage() {
  return <ConnectionsScreen />;
}
