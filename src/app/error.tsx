"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="message-page">
      <p className="eyebrow">Небольшая заминка</p>
      <h1>Попробуем ещё раз.</h1>
      <p>Не удалось загрузить страницу. Подождите немного и повторите попытку.</p>
      <button type="button" className="button button-primary" onClick={reset}>Попробовать снова</button>
    </section>
  );
}
