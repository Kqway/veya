import "server-only";
import { z } from "zod";
import type { AiProvider, AiRequest, ParseInput } from "./types";
import type { ParsedIntent } from "@/features/intents/structured";
import type { SeekingSuggestion } from "@/features/discovery/seeking-suggestion";
import {
  parseInputSchema,
  planContextSchema,
  applicableReasons,
} from "./schemas";
function shiftDate(date: string, days: number): string | null {
  const shifted = new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000)
    .toISOString()
    .split("T")[0];
  return z.iso.date().safeParse(shifted).success ? shifted! : null;
}
function datePhrase(text: string, phrases: string): string | undefined {
  return text.match(
    new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])(${phrases})(?=$|[^\\p{L}\\p{N}_])`,
      "iu",
    ),
  )?.[1];
}
function parse(input: ParseInput): ParsedIntent {
  const text = input.text;
  const choices: [string, RegExp][] = [
    ["coffee", /coffee|кофе/iu],
    ["dinner", /\beat\b|\bfood\b|dinner|lunch|поесть|ужин|обед/iu],
    ["movie", /movie|cinema|кино|фильм/iu],
    ["walk", /\bwalk\b|прогул/iu],
    ["games", /\bgames?\b|игр/iu],
    ["factorio", /factorio/iu],
    ["study", /study|уч[её]б/iu],
    ["travel", /travel|\btrip\b|путешеств/iu],
  ];
  const activities = choices
    .filter(([, pattern]) => pattern.test(text))
    .map(([activity]) => activity);
  const type = activities.includes("travel")
    ? "travel"
    : activities.includes("factorio") || activities.includes("games")
      ? "game"
      : activities.includes("study")
        ? "study"
        : activities.length
          ? "meet"
          : "general";
  let dateHint: ParsedIntent["dateHint"] = null;
  const explicitDate = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const afterTomorrow = datePhrase(text, "day after tomorrow|послезавтра");
  const tomorrow = datePhrase(text, "tomorrow|завтра");
  const today = datePhrase(text, "today|tonight|сегодня");
  const thisWeek = datePhrase(text, "this week|на этой неделе");
  if (explicitDate && z.iso.date().safeParse(explicitDate).success)
    dateHint = {
      startDate: explicitDate,
      endDate: explicitDate,
      text: explicitDate,
    };
  else if (afterTomorrow || tomorrow) {
    const date = shiftDate(input.referenceDate, afterTomorrow ? 2 : 1);
    if (date)
      dateHint = {
        startDate: date,
        endDate: date,
        text: (afterTomorrow || tomorrow)!,
      };
  } else if (today)
    dateHint = {
      startDate: input.referenceDate,
      endDate: input.referenceDate,
      text: today,
    };
  else if (thisWeek) {
    // A Monday–Sunday calendar week, limited to today and future days.
    const day = new Date(`${input.referenceDate}T12:00:00Z`).getUTCDay();
    const endDate = shiftDate(input.referenceDate, (7 - day) % 7);
    if (endDate)
      dateHint = { startDate: input.referenceDate, endDate, text: thisWeek };
  }
  const place = text
    .match(
      /(?:\bin\s+|\bnear\s+|\baround\s+|(?:^|\s)в\s+|рядом с\s+)([^.!?\n,]+)/iu,
    )?.[1]
    ?.split(
      /\s+(?:day after tomorrow|послезавтра|tomorrow|today|tonight|this week|under|up to|on\b|and\b|завтра|сегодня|на этой неделе|до\b)/iu,
    )[0]
    ?.trim();
  const budget = text.match(
    /(?:(?:under|up to|less than|до)\s+)?(?:[$€£₽]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:USD|EUR|GBP|RUB|JPY|KWD)\b)/iu,
  )?.[0];
  return {
    type,
    activities,
    location: place && place.length <= 120 ? place : null,
    dateHint,
    budgetHint: budget && budget.length <= 80 ? budget : null,
  };
}
function parseSeeking(input: ParseInput): SeekingSuggestion {
  const text = input.text;
  const activities: [string, string, string][] = [
    ["chess", "Chess", "chess|шахмат(?:ы|ам|ах)?"],
    ["gym", "Gym", "gym|спортзал|тренаж[её]рный зал|зал"],
    ["calculus", "Calculus study", "calculus|матанализ(?:а|у|ом|е)?|матан|математический анализ"],
    ["walk", "Walking", "walk|walking|прогулк(?:а|и|у|ой)|гулять"],
    ["board-games", "Board games", "board[ -]games?|настолк(?:а|и|у)|настольны[ех] игр(?:ы)?"],
    ["coffee", "Coffee", "coffee|кофе"],
    ["english-practice", "English practice", "english practice|practi[cs]e english|практик(?:а|и|у) английского"],
    ["football", "Football", "football|футбол"],
  ];
  const activity = activities.find(([, , phrases]) => datePhrase(text, phrases));
  const online = datePhrase(text, "online|онлайн");
  const inPerson = datePhrase(text, "in[ -]person|offline|очно|офлайн");
  const oneToOne = datePhrase(text, "one[ -]to[ -]one|one person|one partner|одного человека|один на один|вдво[её]м");
  const group = datePhrase(text, "group|групп(?:а|ой|у)|компани(?:я|ей|ю)");
  const skills: [NonNullable<SeekingSuggestion["skill"]>, string][] = [
    ["beginner", "beginner|начинающ(?:ий|ая|ие)|новичок"],
    ["casual", "casual|любитель"],
    ["intermediate", "intermediate|средний(?: уровень)?"],
    ["advanced", "advanced|продвинутый"],
    ["expert", "expert|эксперт"],
    ["any", "any (?:skill|level)|любой уровень"],
  ];
  const skill = skills.find(([, phrases]) => datePhrase(text, phrases));
  const evening = datePhrase(text, "evening|tonight|вечер(?:ом|а)?");
  // Keep unsupported relative days unknown instead of reading their substrings.
  const afterTomorrow = datePhrase(text, "day after tomorrow|послезавтра");
  const tomorrow = !afterTomorrow && datePhrase(text, "tomorrow|завтра");
  const today = datePhrase(text, "today|tonight|сегодня");
  const date = tomorrow ? shiftDate(input.referenceDate, 1) : today ? input.referenceDate : null;
  return {
    activityKey: activity?.[0] ?? null,
    activityLabel: activity?.[1] ?? null,
    interactionMode: online && inPerson ? "either" : online ? "online" : inPerson ? "in_person" : null,
    format: oneToOne && group ? "either" : oneToOne ? "one_to_one" : group ? "group" : null,
    city: datePhrase(text, "Moscow|Москв(?:а|е|у|ы)") ? "Moscow" : null,
    area: null,
    skill: skill?.[0] ?? null,
    languages: [],
    tags: [],
    timeHint: date ? `${date}${evening ? " evening" : ""}` : evening ? "evening" : null,
  };
}
/** Small explicit vocabulary and templates, not a language model. */
export class MockAiProvider implements AiProvider {
  readonly name = "mock" as const;
  async complete(request: AiRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (request.task === "parse_intent")
      return parse(parseInputSchema.parse(request.input));
    if (request.task === "parse_seeking")
      return parseSeeking(parseInputSchema.parse(request.input));
    const context = planContextSchema.parse(request.input);
    if (request.task === "explain_plan")
      return { reasons: applicableReasons(context) };
    const activity = context.proposal.activity;
    return {
      title: activity
        ? `A little ${activity}, together`.slice(0, 100)
        : "A little time together",
      idea: activity
        ? `Start with ${activity} and leave room for a conversation. Keep it simple and choose the details together.`
        : "Keep the meetup simple: catch up, share an idea, and choose what feels good together.",
    };
  }
}
