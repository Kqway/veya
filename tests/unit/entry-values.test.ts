import { afterEach, describe, expect, it } from "vitest";
import {
  fieldsFromParticipant,
  localWindow,
  nextDays,
  parseMoney,
  participantFromForm,
  validateEntryAvailability,
} from "@/features/entry/form-values";
const originalTimezone = process.env.TZ;
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe("participant form conversion", () => {
  it("uses exact currency minor units without floating point rounding", () => {
    expect(parseMoney("10.29", "USD")).toBe(1029);
    expect(parseMoney("10", "JPY")).toBe(10);
    expect(parseMoney("0.123", "KWD")).toBe(123);
    expect(parseMoney("", "USD")).toBeNull();
    expect(parseMoney("0", "USD")).toBe(0);
    for (const [value, currency] of [
      ["-1", "USD"],
      ["1.234", "USD"],
      ["1.1", "JPY"],
      ["1e3", "USD"],
      ["1000001", "USD"],
      ["2", "ZZZ"],
    ]) {
      expect(() => parseMoney(value!, currency!)).toThrow();
    }
  });
  it("builds seven local calendar dates across DST", () => {
    process.env.TZ = "America/New_York";
    const days = nextDays(new Date("2026-03-07T23:00:00-05:00"));
    expect(days[0]?.label).toBe("Сегодня");
    expect(days[1]?.label).toBe("вс, 8 мар.");
    expect(
      days.map((day) => day.date),
    ).toEqual([
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
    ]);
  });
  it("converts local times and rejects nonexistent DST/date and reversed ranges", () => {
    process.env.TZ = "America/New_York";
    expect(localWindow("2026-03-08", "09:00", "12:00")).toEqual({
      startAt: "2026-03-08T13:00:00.000Z",
      endAt: "2026-03-08T16:00:00.000Z",
    });
    expect(() => localWindow("2026-03-08", "02:30", "04:00")).toThrow();
    expect(() => localWindow("2026-02-30", "09:00", "12:00")).toThrow();
    expect(() => localWindow("2026-03-08", "12:00", "09:00")).toThrow();
  });
  it("requires future nonoverlapping windows inside the invite lifetime", () => {
    const now = new Date("2026-09-30T12:00Z"),
      expiry = "2026-10-07T12:00Z";
    const a = { startAt: "2026-10-01T09:00Z", endAt: "2026-10-01T12:00Z" };
    const b = { startAt: "2026-10-01T12:00Z", endAt: "2026-10-01T13:00Z" };
    expect(() => validateEntryAvailability([a, b], expiry, now)).not.toThrow();
    expect(() => validateEntryAvailability([], expiry, now)).toThrow(
      /хотя бы один/i,
    );
    expect(() => validateEntryAvailability([a, a], expiry, now)).toThrow(
      /пересекаются/i,
    );
    expect(() =>
      validateEntryAvailability(
        [{ startAt: "2026-09-29T09:00Z", endAt: "2026-09-29T12:00Z" }],
        expiry,
        now,
      ),
    ).toThrow();
    expect(() => validateEntryAvailability([a], a.startAt, now)).toThrow();
  });
  it("preserves saved comma/quote values while adding another preference", () => {
    const own = {
      displayName: "Sam",
      budgetMin: null,
      budgetMax: null,
      currency: null,
      notes: "",
      availability: [],
      preferences: [
        { category: "location" as const, value: "washington, dc" },
        { category: "activity" as const, value: 'a "co-op" game' },
      ],
    };
    const fields = fieldsFromParticipant(own);
    fields.location += ", arlington";
    expect(participantFromForm(fields, [], own).preferences).toEqual([
      { category: "activity", value: 'a "co-op" game' },
      { category: "location", value: "washington, dc" },
      { category: "location", value: "arlington" },
    ]);
  });
  it("preserves unchanged saved preference values containing commas", () => {
    const own = {
      displayName: "Sam",
      budgetMin: null,
      budgetMax: null,
      currency: null,
      notes: "",
      availability: [],
      preferences: [{ category: "location" as const, value: "washington, dc" }],
    };
    expect(
      participantFromForm(fieldsFromParticipant(own), [], own).preferences,
    ).toEqual(own.preferences);
  });
  it("keeps min/max, zero budgets and normalized unique preferences", () => {
    const result = participantFromForm(
      {
        displayName: " Maya ",
        budgetMin: "0",
        budgetMax: "10.29",
        currency: "USD",
        notes: " Hi ",
        activity: "Coffee, coffee",
        dietary: "Vegetarian",
        location: "",
      },
      [],
    );
    expect(result).toMatchObject({
      displayName: "Maya",
      budgetMin: 0,
      budgetMax: 1029,
      currency: "USD",
      notes: "Hi",
      preferences: [
        { category: "activity", value: "coffee" },
        { category: "dietary", value: "vegetarian" },
      ],
    });
    expect(() =>
      participantFromForm(
        {
          displayName: "Maya",
          budgetMin: "11",
          budgetMax: "10",
          currency: "USD",
          notes: "",
          activity: "",
          dietary: "",
          location: "",
        },
        [],
      ),
    ).toThrow();
  });
});
