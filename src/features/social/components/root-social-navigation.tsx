"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSocialLive } from "@/features/realtime/client";
import { NotificationBadge } from "@/features/notifications/components";

export function RootSocialNavigation() {
  const { profileActive } = useSocialLive();
  const path = usePathname();
  if(path === "/" || ["/people","/room","/offer","/preferences","/profile"].some(prefix => path === prefix || path.startsWith(prefix+"/"))) return <nav className="social-nav social-root-nav" aria-label="Основная навигация">
    <Link href="/" aria-current={path === "/" ? "page" : undefined}>Сейчас</Link>
    <Link href="/people" aria-current={path === "/people" || path.startsWith("/room/") ? "page" : undefined}>Люди</Link>
    <Link href="/profile" aria-current={path.startsWith("/profile") || path === "/preferences" ? "page" : undefined}>Я</Link>
  </nav>;
  if (!profileActive) return null;
  return <nav className="social-nav social-root-nav" aria-label="Ваш Intavro">
    <Link href="/profile">Моё пространство</Link>
    <Link href="/notifications">Уведомления <NotificationBadge enabled={profileActive} /></Link>
  </nav>;
}
