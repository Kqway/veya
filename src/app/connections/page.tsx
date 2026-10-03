import type { Metadata } from "next";
import { ConnectionsScreen } from "@/features/social/components/connections-screen";
export const metadata: Metadata = {
  title: "Запросы",
  robots: { index: false, follow: false },
};
export default function ConnectionsPage() {
  return <ConnectionsScreen />;
}
