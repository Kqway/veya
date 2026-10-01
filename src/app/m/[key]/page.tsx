import type { Metadata } from "next";
import { MatchScreen } from "@/features/social/components/match-screen";
export const metadata: Metadata = {
  title: "Conversation | Veya",
  robots: { index: false, follow: false },
};
export default async function MatchPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  return <MatchScreen matchKey={key} />;
}
