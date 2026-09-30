import type { Metadata } from "next";
import { InviteScreen } from "@/features/entry/components/invite-screen";
export const metadata: Metadata = {
  title: "You're invited",
  robots: { index: false, follow: false },
};
export default async function InvitePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <InviteScreen key={slug} slug={slug} />;
}
