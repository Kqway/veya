import { getInvitePreview } from "@/features/entry/preview";
import { shareImage } from "@/components/share-image";
export const alt = "Bring your people together with Veya";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";
export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return shareImage(await getInvitePreview((await params).slug));
}
