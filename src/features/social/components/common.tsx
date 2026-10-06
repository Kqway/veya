"use client";
import Link from "next/link";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { Identity } from "../client";
export function SocialShell({
  title,
  children,
  navigation = true,
}: {
  title: string;
  children: ReactNode;
  navigation?: boolean;
}) {
  return (
    <section className="social-shell">
      {navigation && <nav className="social-nav" aria-label="Навигация Veya">
        <Link href="/discover">Найти людей</Link>
        <Link href="/network/connections">Запросы</Link>
        <Link href="/seek/new">Новое занятие</Link>
        <Link href="/profile">Моё пространство</Link>
      </nav>}
      <p className="eyebrow">Находите своих людей через общие занятия</p>
      <h1>{title}</h1>
      {children}
      <p className="social-safety">
        Для первой встречи выбирайте общественное место. Не сообщайте домашний адрес и расскажите о своих планах тому, кому доверяете.
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
      Люди, с которыми вы знакомитесь в Veya, видят только то, что вы решите раскрыть. В режиме «Инкогнито» для каждой пары используются отдельные псевдоним и аватар. При этом личные сведения и встречи вживую могут раскрыть вашу личность.
    </p>
  );
}

export function SocialLiveStatus({ status, reconnect }: { status: string; reconnect: () => void }) {
  if (status !== "offline" && status !== "reconnecting" && status !== "retrying") return null;
  return <aside className="social-live-status" aria-label="Состояние обновлений в реальном времени">
    <p role="status">{status === "offline" ? "Обновления в реальном времени недоступны. Вы можете обновлять страницу вручную и продолжать пользоваться Veya." : "Восстанавливаем подключение для обновлений в реальном времени. Вы можете обновлять страницу вручную."}</p>
    <button className="social-text-button" onClick={reconnect}>Восстановить обновления</button>
  </aside>;
}
