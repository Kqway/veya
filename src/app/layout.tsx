import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Script from "next/script";
import { Brand } from "@/components/brand";
import { ArrowIcon } from "@/components/arrow-icon";
import { getServerEnv } from "@/lib/config/server";
import { AnalyticsProvider } from "@/lib/analytics/browser";
import { RecoveryKeyProvider } from "@/features/social/components/recovery-key-provider";
import { RootSocialNavigation } from "@/features/social/components/root-social-navigation";
import { SocialLiveProvider } from "@/features/realtime/client";
import "./globals.css";

// Read runtime analytics/origin configuration instead of freezing it at build time.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(getServerEnv().NEXT_PUBLIC_APP_URL),
    title: { default: "Intavro — Вместе от идеи к встрече", template: "%s · Intavro" },
    description:
      "Расскажите Intavro, чем хотите заняться. Найдите компанию, решите, что раскрыть о себе, и договоритесь о встрече.",
    applicationName: "Intavro",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8f6ef",
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
            <Link className="header-link" href="/plan#how-it-works">
              Как это работает <ArrowIcon />
            </Link>
          </header>
          <main id="main-content" tabIndex={-1}>
            <AnalyticsProvider enabled={getServerEnv().ANALYTICS_ENABLED}>
              <SocialLiveProvider><RootSocialNavigation /><RecoveryKeyProvider>{children}</RecoveryKeyProvider></SocialLiveProvider>
            </AnalyticsProvider>
          </main>
          <footer className="site-footer">
            <p>Одна идея. Много возможностей.</p>
            <span>Создано для встреч.</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
