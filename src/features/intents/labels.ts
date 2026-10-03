import type { ParsedIntent } from "./structured";

export const intentTypeLabels: Record<ParsedIntent["type"], string> = {
  general: "Что угодно вместе",
  meet: "Встреча",
  travel: "Поездка",
  game: "Игры",
  study: "Учёба",
};

const activityLabels: Record<string, string> = {
  coffee: "Кофе",
  dinner: "Ужин",
  walk: "Прогулка",
  games: "Игры",
  study: "Учёба",
  adventure: "Приключение",
  movie: "Кино",
  travel: "Поездка",
  factorio: "Factorio",
};

export function activityLabel(value: string): string {
  return activityLabels[value.toLowerCase()] ?? value;
}
