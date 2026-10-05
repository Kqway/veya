import type { Metadata } from "next";
import { PeopleScreen } from "@/features/intent-product/components/people-screen";
export const metadata: Metadata = { title: "Люди", robots: { index: false, follow: false } };
export default function Page() { return <PeopleScreen />; }
