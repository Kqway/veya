export function LoadingPlan({ results = false }: { results?: boolean }) {
  return (
    <section
      className="message-page loading-plan"
      aria-busy="true"
      aria-label={results ? "Загрузка результатов" : "Загрузка приглашения"}
    >
      <p className="eyebrow">Меньше переписки</p>
      <h1>{results ? "Ищем подходящее время…" : "Загружаем ваш план…"}</h1>
      <p role="status">
        {results
          ? "Сопоставляем свободное время участников."
          : "Готовим ваше приглашение."}
      </p>
      <div className="loading-shapes" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}
