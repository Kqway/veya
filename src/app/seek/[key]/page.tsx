import type { Metadata } from "next";
import { OwnSeekScreen } from "@/features/social/components/seek-screen";
export const metadata: Metadata = {
  title: "Ваша заявка",
  robots: { index: false, follow: false },
};
export default async function SeekPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  return <OwnSeekScreen postKey={key} />;
}
