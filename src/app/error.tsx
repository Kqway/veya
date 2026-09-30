"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="message-page">
      <p className="eyebrow">A small bump in the road</p>
      <h1>Let&apos;s try that again.</h1>
      <p>Something went wrong loading this page. Your next good idea can wait a moment.</p>
      <button type="button" className="button button-primary" onClick={reset}>Try again</button>
    </section>
  );
}
