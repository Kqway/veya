"use client";
import Link from "next/link";
import { useSocialLive } from "@/features/realtime/client";
import { NotificationBadge } from "@/features/notifications/components";

export function RootSocialNavigation() {
  const { profileActive } = useSocialLive();
  if (!profileActive) return null;
  return <nav className="social-nav social-root-nav" aria-label="Your Veya">
    <Link href="/notifications">Notifications <NotificationBadge enabled={profileActive} /></Link>
  </nav>;
}
