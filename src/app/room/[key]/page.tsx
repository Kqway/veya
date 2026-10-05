import type { Metadata } from "next";
import { RoomScreen } from "@/features/intent-product/components/room-screen";
export const metadata: Metadata = { title: "Временная комната", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ key: string }> }) { return <RoomScreen roomKey={(await params).key} />; }
