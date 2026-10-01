type Activity = { key: string; label: string; aliases: string };

/** Explicit, extensible vocabulary. No candidate text or profile attributes are inputs. */
const catalogue: readonly Activity[] = [
  { key: "chess", label: "Chess", aliases: "chess|шахмат(?:ы|ам|ах|ами)?|шахматишки|поиграть в шахматы|сыграть партию" },
  { key: "gym", label: "Gym", aliases: "gym|спортзал|тренаж[её]рный зал|зал" },
  { key: "calculus", label: "Calculus study", aliases: "calculus|матанализ(?:а|у|ом|е)?|матан|математический анализ" },
  { key: "walk", label: "Walking", aliases: "walk|walking|прогулк(?:а|и|у|ой)|гулять" },
  { key: "board-games", label: "Board games", aliases: "board[ -]games?|настолк(?:а|и|у)|настольны[ех] игр(?:ы)?" },
  { key: "coffee", label: "Coffee", aliases: "coffee|кофе" },
  { key: "english-practice", label: "English practice", aliases: "english practice|practi[cs]e english|практик(?:а|и|у) английского" },
  { key: "football", label: "Football", aliases: "football|футбол" },
];
const clean = (value: string) => value.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ");
const expressions = catalogue.map((activity) => ({
  ...activity,
  exact: new RegExp(`^(?:${activity.key}|${activity.aliases})$`, "u"),
  phrase: new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${activity.aliases})(?=$|[^\\p{L}\\p{N}_])`, "u"),
}));

/** Recognizes an unambiguous activity in the owner's text. Unknown text stays manual. */
export function normalizeActivity(text: string): { key: string; label: string } | null {
  const value = clean(text);
  const matches = expressions.filter((activity) => activity.phrase.test(value));
  if (matches.length !== 1) return null;
  const activity = matches[0]!;
  return { key: activity.key, label: activity.label };
}

/** Exact aliases only: a custom key such as chess-club is never substring-matched. */
export function normalizeActivityKey(value: string): string {
  const key = clean(value);
  return expressions.find((activity) => activity.exact.test(key))?.key ?? key;
}
