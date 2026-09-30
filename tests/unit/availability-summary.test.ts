import { afterEach, expect, it } from "vitest";
import { formatWindow } from "@/features/entry/components/availability-picker";
const previous = process.env.TZ;
afterEach(() => {
  if (previous === undefined) delete process.env.TZ;
  else process.env.TZ = previous;
});
it("shows an end date for overnight and 24-hour saved windows", () => {
  process.env.TZ = "UTC";
  expect(
    formatWindow({
      startAt: "2026-10-01T22:00:00Z",
      endAt: "2026-10-02T02:00:00Z",
    }),
  ).toMatch(/Oct 2/);
  expect(
    formatWindow({
      startAt: "2026-10-01T22:00:00Z",
      endAt: "2026-10-02T22:00:00Z",
    }),
  ).toMatch(/Oct 2/);
});
