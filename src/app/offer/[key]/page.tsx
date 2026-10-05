import type { Metadata } from "next";
import { OfferScreen } from "@/features/intent-product/components/offer-screen";
export const metadata: Metadata = { title: "Предложение", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ key: string }> }) { return <OfferScreen offerKey={(await params).key} />; }
