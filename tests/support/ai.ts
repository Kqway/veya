import type { PlanContext } from "@/lib/ai/types";
export const parseInput = {
  text: "eat and watch a movie in Bristol tomorrow under $20",
  referenceDate: "2026-09-30",
  timeZone: "Europe/Moscow",
};
export const parsedIntent = {
  type: "meet",
  activities: ["dinner", "movie"],
  location: "Bristol",
  dateHint: {
    startDate: "2026-10-01",
    endDate: "2026-10-01",
    text: "tomorrow",
  },
  budgetHint: "under $20",
};
export const context: PlanContext = {
  intent: {
    rawText: "Coffee together",
    activities: ["coffee"],
    location: null,
  },
  proposal: {
    startAt: "2026-10-01T18:00:00Z",
    endAt: "2026-10-01T19:00:00Z",
    availableCount: 2,
    partialCount: 1,
    totalCount: 3,
    durationMinutes: 60,
    shortened: false,
    activity: "coffee",
    budgetAssessment: "compatible",
  },
};
export function openAiEnvelope(value: unknown) {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify(value), refusal: null },
      },
    ],
  };
}
