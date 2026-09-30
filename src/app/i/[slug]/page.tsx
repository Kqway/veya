import { getInvitePreview } from "@/features/entry/preview";
import type { Metadata } from "next";
import { InviteScreen } from "@/features/entry/components/invite-screen";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const preview = await getInvitePreview(slug);
  return {
    title: preview.title,
    description: preview.description,
    robots: { index: false, follow: false },
    openGraph: {
      title: preview.title,
      description: preview.description,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: preview.title,
      description: preview.description,
    },
  };
}
export default async function InvitePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <InviteScreen key={slug} slug={slug} />;
}
