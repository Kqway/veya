import { activityLabel } from "@/features/intents/labels";
import type { BudgetAssessment } from "./types";
/** Presentation stays outside the versioned engine/fingerprint and persisted votes. */
export function proposalCopy(proposal: {
  activity: string | null;
  availableCount: number;
  totalCount: number;
  durationMinutes: number;
  shortened: boolean;
  budgetAssessment: BudgetAssessment;
}) {
  const explanation =
    (proposal.availableCount === proposal.totalCount
      ? `Это время подходит всем (${proposal.totalCount}).`
      : `Общего времени для всех нет, но этот вариант подходит ${proposal.availableCount} из ${proposal.totalCount} участников.`) +
    (proposal.shortened ? ` Более короткая встреча: ${proposal.durationMinutes} мин.` : "") +
    (proposal.budgetAssessment === "incompatible"
      ? " Нужно согласовать бюджет."
      : proposal.budgetAssessment === "different-currencies"
        ? " Бюджеты указаны в разных валютах; сравните расходы вместе."
        : "");
  return {
    title: proposal.activity ? `Время для занятия «${activityLabel(proposal.activity)}»` : "Удобное время для встречи",
    explanation,
  };
}
