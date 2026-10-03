import type { Metadata } from "next";
import { NewSeekScreen } from "@/features/social/components/seek-screen";
export const metadata: Metadata = {
  title: "Новое занятие",
  robots: { index: false, follow: false },
};
export default function NewSeekPage() {
  return <NewSeekScreen />;
}
