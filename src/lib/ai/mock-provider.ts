import "server-only";
import { z } from "zod";
import type { AiProvider, AiRequest, ParseInput } from "./types";
import type { ParsedIntent } from "@/features/intents/structured";
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
/** Small explicit vocabulary and templates, not a language model. */
export class MockAiProvider implements AiProvider {
  readonly name = "mock" as const;
  async complete(request: AiRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (request.task === "parse_intent")
      return parse(parseInputSchema.parse(request.input));
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
