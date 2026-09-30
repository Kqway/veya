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
    ? `${creatorName} wants to make a plan 👀`
    : "Let's make a plan · Veya";
  const text =
    "Add your availability and Veya will find what works for everyone. No account needed.";
  async function copy() {
    if (locked.current || !origin) return;
    locked.current = true;
    setBusy(true);
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied. Bring your people!");
      track("invite_link_copied");
    } catch {
      setMessage("Copy the link below to invite your friends.");
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
      setMessage("Invite shared. Bring your people!");
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError"))
        setMessage("Sharing is unavailable. Copy the link below instead.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="entry-card share-panel"
      aria-label="Invite your friends"
    >
      <h2>Good plans need good people.</h2>
      <p className="quiet-copy">
        Send this link. They can join without an account.
      </p>
      <div className="form-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={busy || !origin}
          onClick={() => void copy()}
        >
          Copy link
        </button>
        <a
          className="button button-secondary"
          href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`${title} ${text}`)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Telegram share
        </a>
        {nativeShare && (
          <button
            className="button button-secondary"
            type="button"
            disabled={busy || !origin}
            onClick={() => void share()}
          >
            Share invite
          </button>
        )}
      </div>
      <label className="field link-field">
        Invite link
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
