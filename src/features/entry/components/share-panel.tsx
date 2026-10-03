"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { useAnalytics } from "@/lib/analytics/browser";
const subscribe = () => () => {};
export function SharePanel({
  slug,
  creatorName,
}: {
  slug: string;
  creatorName?: string;
}) {
  const origin = useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );
  const nativeShare = useSyncExternalStore(
    subscribe,
    () => typeof navigator.share === "function",
    () => false,
  );
  const url = `${origin}/i/${slug}`,
    input = useRef<HTMLInputElement>(null),
    track = useAnalytics();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const title = creatorName
    ? `${creatorName} предлагает встретиться 👀`
    : "Давайте встретимся · Intavro";
  const text =
    "Укажите свободное время, и Intavro найдёт подходящий вариант для всех. Регистрация не нужна.";
  async function copy() {
    if (locked.current || !origin) return;
    locked.current = true;
    setBusy(true);
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Ссылка скопирована. Приглашайте друзей!");
      track("invite_link_copied");
    } catch {
      setMessage("Скопируйте ссылку ниже, чтобы пригласить друзей.");
      input.current?.focus();
      input.current?.select();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function share() {
    if (locked.current || !origin) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      await navigator.share({
        title,
        text,
        url,
      });
      setMessage("Приглашение отправлено. Собирайте друзей!");
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError"))
        setMessage("Не удалось поделиться приглашением. Скопируйте ссылку ниже.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="entry-card share-panel"
      aria-label="Пригласите друзей"
    >
      <h2>Хороший план начинается с хорошей компании.</h2>
      <p className="quiet-copy">
        Отправьте эту ссылку. Присоединиться можно без регистрации.
      </p>
      <div className="form-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !origin}
          onClick={() => void copy()}
        >
          Скопировать ссылку
        </button>
        <a
          className="button button-secondary"
          href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`${title} ${text}`)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Поделиться в Telegram
        </a>
        {nativeShare && (
          <button
            className="button button-secondary"
            type="button"
            disabled={busy || !origin}
            onClick={() => void share()}
          >
            Поделиться приглашением
          </button>
        )}
      </div>
      <label className="field link-field">
        Ссылка на приглашение
        <input
          ref={input}
          value={url}
          readOnly
          onFocus={(e) => e.target.select()}
        />
      </label>
      <p className="quiet-copy" role="status">
        {message}
      </p>
    </section>
  );
}
