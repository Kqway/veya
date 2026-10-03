import type { Metadata } from "next";
import { DiscoverScreen } from "@/features/social/components/discover-screen";
export const metadata: Metadata = {
  title: "Найти людей",
  robots: { index: false, follow: false },
};
export default function DiscoverPage() {
  return <DiscoverScreen />;
}
