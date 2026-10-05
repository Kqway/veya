import type { Metadata } from "next";
import { PreferencesScreen } from "@/features/intent-product/components/preferences-screen";
export const metadata: Metadata = { title: "Ваши правила", robots: { index: false, follow: false } };
export default function Page() { return <PreferencesScreen />; }
