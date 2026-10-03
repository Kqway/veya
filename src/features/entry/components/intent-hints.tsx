import type { ParsedIntent } from "@/features/intents/structured";
export function IntentHints({
  dateHint,
  budgetHint,
}: {
  dateHint: ParsedIntent["dateHint"] | undefined;
  budgetHint: string | null | undefined;
}) {
  if (!dateHint && !budgetHint) return null;
  const day = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString("ru-RU", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return (
    <div className="intent-hints">
      {dateHint && (
        <p>
          Указанные даты: {day(dateHint.startDate)}
          {dateHint.endDate !== dateHint.startDate &&
            ` – ${day(dateHint.endDate)}`}
        </p>
      )}
      {budgetHint && <p>Указанный бюджет: {budgetHint}</p>}
      <p className="quiet-copy">
        Это отправная точка. Друзья сами выберут время и бюджет.
      </p>
    </div>
  );
}
