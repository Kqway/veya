"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { useAnalytics } from "@/lib/analytics/browser";
const subscribe = () => () => {};
export function SharePanel({ slug }: { slug: string }) {
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
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied. Bring your people!");
      track("invite_link_copied");
    } catch {
      setMessage("Copy the link below to invite your friends.");
      input.current?.focus();
      input.current?.select();
    }
  }
  async function share() {
    try {
      await navigator.share({
        title: "Let's make a plan · Veya",
        text: "Add yourself — no account needed.",
        url,
      });
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError"))
        setMessage("Sharing is unavailable. Copy the link below instead.");
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
          onClick={() => void copy()}
        >
          Copy link
        </button>
        <a
          className="button button-secondary"
          href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent("Let's make a plan! Add yourself — no account needed.")}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Telegram share
        </a>
        {nativeShare && (
          <button
            className="button button-secondary"
            type="button"
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
