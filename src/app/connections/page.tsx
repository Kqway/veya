import type { Metadata } from "next";
import { GoalConnections } from "@/features/goals/components/connections";
export const metadata: Metadata = {
  title: "Способности и подключения",
  robots: { index: false, follow: false },
};
export default function ConnectionsPage() {
  return <GoalConnections />;
}
