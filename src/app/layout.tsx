import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Brand } from "@/components/brand";
import { getServerEnv } from "@/lib/config/server";
import { AnalyticsProvider } from "@/lib/analytics/browser";
import { RecoveryKeyProvider } from "@/features/social/components/recovery-key-provider";
import { GoalNavigation } from "@/features/goals/components/navigation";
import { SocialLiveProvider } from "@/features/realtime/client";
import "./globals.css";
import "@/features/goals/goals.css";

// Read runtime analytics/origin configuration instead of freezing it at build time.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(getServerEnv().NEXT_PUBLIC_APP_URL),
    title: { default: "Veya — Что должно произойти?", template: "%s · Veya" },
    description:
      "Вы задаёте цель. Veya строит план, действует в пределах разрешений и возвращается с результатом.",
    applicationName: "Veya",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
    themeColor: "#f7f7f2",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <Script src="/history-guard.js" strategy="beforeInteractive" />
        <a href="#main-content" className="skip-link">
          Перейти к содержимому
        </a>
        <div className="app-shell">
          <header className="site-header">
            <Brand />
            <GoalNavigation />
          </header>
          <main id="main-content" tabIndex={-1}>
            <AnalyticsProvider enabled={getServerEnv().ANALYTICS_ENABLED}>
              <SocialLiveProvider><RecoveryKeyProvider>{children}</RecoveryKeyProvider></SocialLiveProvider>
            </AnalyticsProvider>
          </main>
          <footer className="site-footer">
            <p>Veya · От намерения к результату</p>
            <span>Autonomous Goal Network</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
