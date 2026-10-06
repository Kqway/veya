"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function GoalNavigation() {
  const path = usePathname();
  return (
    <nav className="goal-navigation" aria-label="Основная навигация">
      <Link
        href="/"
        aria-current={
          path === "/" || path.startsWith("/goals/") ? "page" : undefined
        }
      >
        Цели
      </Link>
      <Link
        href="/activity"
        aria-current={path === "/activity" ? "page" : undefined}
      >
        Активность
      </Link>
      <Link
        className="goal-profile-link"
        href="/settings"
        aria-current={
          ["/settings", "/profile", "/connections", "/autonomy"].includes(path)
            ? "page"
            : undefined
        }
      >
        <span className="goal-profile-symbol" aria-hidden="true">
          v
        </span>
        <span>Профиль</span>
      </Link>
    </nav>
  );
}
