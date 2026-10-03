"use client";
import Link from "next/link";
import { useSocialLive } from "@/features/realtime/client";
import { NotificationBadge } from "@/features/notifications/components";

export function RootSocialNavigation() {
  const { profileActive } = useSocialLive();
  if (!profileActive) return null;
  return <nav className="social-nav social-root-nav" aria-label="Ваш Intavro">
    <Link href="/notifications">Уведомления <NotificationBadge enabled={profileActive} /></Link>
  </nav>;
}
