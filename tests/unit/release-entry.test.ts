import { describe, expect, it } from "vitest";
import {
  localWindow,
  validateEntryAvailability,
} from "@/features/entry/form-values";
describe("preserved availability and overnight entry", () => {
  it("keeps exactly saved elapsed windows while new past times remain invalid", () => {
    const old = {
      startAt: "2026-10-01T09:00:00Z",
      endAt: "2026-10-01T12:00:00Z",
    };
    const future = {
      startAt: "2026-10-02T09:00:00Z",
      endAt: "2026-10-02T12:00:00Z",
    };
    const now = new Date("2026-10-01T09:01:00Z"),
      expires = "2026-10-07T23:00:00Z";
    expect(() =>
      validateEntryAvailability([old, future], expires, now, [old]),
    ).not.toThrow();
    expect(() =>
      validateEntryAvailability([old, future], expires, now, []),
    ).toThrow(/future/);
    expect(() =>
      validateEntryAvailability(
        [{ ...old, startAt: "2026-10-01T08:59:00Z" }, future],
        expires,
        now,
        [old],
      ),
    ).toThrow(/future/);
  });
  it("accepts an explicit next-day end without silently guessing overnight", () => {
    const result = localWindow("2026-10-01", "22:00", "01:00", "2026-10-02");
    expect(Date.parse(result.endAt) - Date.parse(result.startAt)).toBe(
      3 * 3600000,
    );
    expect(() => localWindow("2026-10-01", "22:00", "01:00")).toThrow(/after/);
    expect(() =>
      localWindow("2026-10-01", "09:00", "10:00", "2026-10-02"),
    ).toThrow(/24/);
  });
});
