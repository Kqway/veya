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
    new Date(`${date}T12:00:00`).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return (
    <div className="intent-hints">
      {dateHint && (
        <p>
          Dates mentioned: {day(dateHint.startDate)}
          {dateHint.endDate !== dateHint.startDate &&
            ` – ${day(dateHint.endDate)}`}
        </p>
      )}
      {budgetHint && <p>Budget mentioned: {budgetHint}</p>}
      <p className="quiet-copy">
        These are starting points. Friends choose their own times and budgets.
      </p>
    </div>
  );
}
