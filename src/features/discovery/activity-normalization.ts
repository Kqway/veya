type Activity = { key: string; label: string; aliases: string; studySubject?: boolean };

/** Explicit, extensible vocabulary. No candidate text or profile attributes are inputs. */
const catalogue: readonly Activity[] = [
  { key: "dota2", label: "Dota 2", aliases: "dota(?: ?2)?|дот(?:а|у|ы|е|ой)(?: ?2)?" },
  { key: "chess", label: "Шахматы", aliases: "chess|шахмат(?:ы|ам|ах|ами)?|шахматишки|поиграть в шахматы|сыграть партию" },
  { key: "gym", label: "Спортзал", aliases: "gym|спортзал|тренаж[её]рный зал|зал" },
  { key: "calculus", label: "Математический анализ", aliases: "calculus|матанализ(?:а|у|ом|е)?|матан|математический анализ", studySubject: true },
  { key: "walk", label: "Прогулка", aliases: "walk|walking|прогулк(?:а|и|у|ой)|гулять" },
  { key: "running", label: "Бег", aliases: "run|running|jogging|бег|бегать|пробежк(?:а|и|у|ой)" },
  { key: "movies", label: "Кино", aliases: "movies?|cinema|films?|кино|фильм(?:ы|а|ов)?|смотреть фильмы" },
  { key: "gaming", label: "Видеоигры", aliases: "gaming|video games?|computer games?|видеоигр(?:а|ы|у)|компьютерны[ех] игр(?:ы)?" },
  { key: "study", label: "Учёба", aliases: "study|studying|уч[её]б(?:а|ы|у|ой)|учиться" },
  { key: "programming", label: "Программирование", aliases: "programming|coding|программировани(?:е|я|ем)|кодинг", studySubject: true },
  { key: "board-games", label: "Настольные игры", aliases: "board[ -]games?|настолк(?:а|и|у)|настольны[ех] игр(?:ы)?" },
  { key: "coffee", label: "Кофе", aliases: "coffee|кофе" },
  { key: "english-practice", label: "Практика английского", aliases: "english practice|practi[cs]e english|практик(?:а|и|у) английского" },
  { key: "football", label: "Футбол", aliases: "football|soccer|футбол(?:а|у|ом|е)?" },
  { key: "basketball", label: "Баскетбол", aliases: "basketball|баскетбол(?:а|у|ом|е)?" },
  { key: "language-practice", label: "Языковая практика", aliases: "language practice|practi[cs]e languages?|языковая практика|практик(?:а|и|у) языков|разговорная практика" },
];
const clean = (value: string) => value.normalize("NFC").trim().toLowerCase().replace(/\s+/gu, " ");
const expressions = catalogue.map((activity) => ({
  ...activity,
  exact: new RegExp(`^(?:${activity.key}|${activity.aliases})$`, "u"),
  phrase: new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${activity.aliases})(?=$|[^\\p{L}\\p{N}_])`, "u"),
}));
// A study modifier followed directly by an explicit subject names one activity.
// Conjunctions such as "study and programming" still remain ambiguous.
const studyModifier = new RegExp(`(?:^|(?<=[^\\p{L}\\p{N}_]))(?:study|studying|уч[её]ба|учиться) (?=(?:${catalogue.filter((a) => a.studySubject).map((a) => a.aliases).join("|")})(?=$|[^\\p{L}\\p{N}_]))`, "gu");

/** Recognizes an unambiguous activity in the owner's text. Unknown text stays manual. */
export function normalizeActivity(text: string): { key: string; label: string } | null {
  const value = clean(text).replace(studyModifier, "");
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
