"use client";
import Link from "next/link";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { Identity } from "../client";
export function SocialShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="social-shell">
      <nav className="social-nav" aria-label="Social navigation">
        <Link href="/discover">Discover</Link>
        <Link href="/connections">Connections</Link>
        <Link href="/seek/new">New activity</Link>
      </nav>
      <p className="eyebrow">Find your people through an activity</p>
      <h1>{title}</h1>
      {children}
      <p className="social-safety">
        For a first meeting, choose a public place. Keep your home address
        private and tell someone you trust about your plans.
      </p>
    </section>
  );
}
export function SocialError({
  message,
  focusRef,
}: {
  message: string | null;
  focusRef?: RefObject<HTMLParagraphElement | null>;
}) {
  return message ? (
    <p ref={focusRef} tabIndex={-1} className="entry-error" role="alert">
      {message}
    </p>
  ) : null;
}
export function Avatar({ identity }: { identity: Identity }) {
  const hash = [...identity.avatarSeed].reduce(
    (n, c) => (n * 31 + c.charCodeAt(0)) >>> 0,
    0,
  );
  return (
    <span
      className="social-avatar"
      aria-hidden="true"
      style={{ "--avatar-hue": hash % 360 } as CSSProperties}
    >
      <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
        <circle cx="24" cy="18" r={7 + (hash % 3)} fill="currentColor" />
        <path d="M9 42c0-10 6-15 15-15s15 5 15 15" fill="currentColor" />
      </svg>
    </span>
  );
}
export function Person({ identity }: { identity: Identity }) {
  return (
    <div className="social-person">
      <Avatar identity={identity} />
      <strong>{identity.alias}</strong>
    </div>
  );
}
export function PrivacyCopy() {
  return (
    <p className="quiet-copy">
      People you meet through Veya only see what you choose to reveal. Incognito
      uses a different alias and avatar for each pair. Shared details and
      real-world meetings can still identify you.
    </p>
  );
}

export function SocialLiveStatus({ status, reconnect }: { status: string; reconnect: () => void }) {
  if (status !== "offline" && status !== "reconnecting" && status !== "retrying") return null;
  return <aside className="social-live-status" aria-label="Live update status">
    <p role="status">{status === "offline" ? "Live updates are unavailable. You can still refresh and use Veya." : "Reconnecting live updates. You can still refresh manually."}</p>
    <button className="social-text-button" onClick={reconnect}>Retry live updates</button>
  </aside>;
}
