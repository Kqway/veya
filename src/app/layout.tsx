import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ArrowIcon } from "@/components/arrow-icon";
import { getServerEnv } from "@/lib/config/server";
import { AnalyticsProvider } from "@/lib/analytics/browser";
import "./globals.css";

// Read runtime analytics/origin configuration instead of freezing it at build time.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(getServerEnv().NEXT_PUBLIC_APP_URL),
    title: { default: "Veya — Make it happen together", template: "%s · Veya" },
    description:
      "Less planning. More living. Start with what you want to do, and bring your people together.",
    applicationName: "Veya",
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
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <div className="app-shell">
          <header className="site-header">
            <Brand />
            <Link className="header-link" href="/#how-it-works">
              A little idea. A good time. <ArrowIcon />
            </Link>
          </header>
          <main id="main-content" tabIndex={-1}>
            <AnalyticsProvider enabled={getServerEnv().ANALYTICS_ENABLED}>
              {children}
            </AnalyticsProvider>
          </main>
          <footer className="site-footer">
            <p>A little intention. A lot of possibility.</p>
            <span>Made for making plans.</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
