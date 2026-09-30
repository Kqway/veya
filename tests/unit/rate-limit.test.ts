import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "@/lib/security/rate-limit";
const a = "a".repeat(43),
  b = "b".repeat(43);
describe("bounded server rate limiting", () => {
  it("limits anonymous expensive work and restores capacity at deadline", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({
      clock: () => now,
      policies: { ai: { global: 2, guest: 2 } },
    });
    expect(limiter.check("ai").allowed).toBe(true);
    expect(limiter.check("ai").allowed).toBe(true);
    expect(limiter.check("ai")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
    now = 59001;
    expect(limiter.check("ai").retryAfterSeconds).toBe(1);
    now = 60000;
    expect(limiter.check("ai").allowed).toBe(true);
  });
  it("limits valid guest buckets without consuming unrelated guest/global capacity on rejection", () => {
    const limiter = new FixedWindowLimiter({
      policies: { write: { global: 2, guest: 1 } },
    });
    expect(limiter.check("write", a).allowed).toBe(true);
    expect(limiter.check("write", a).allowed).toBe(false);
    expect(limiter.check("write", b).allowed).toBe(true);
    expect(limiter.check("write", "forged").allowed).toBe(false);
  });
  it("keeps AI pressure independent from ordinary writes", () => {
    const limiter = new FixedWindowLimiter({
      policies: { ai: { global: 1, guest: 1 } },
    });
    expect(limiter.check("ai", a).allowed).toBe(true);
    expect(limiter.check("ai", a).allowed).toBe(false);
    expect(limiter.check("write", a).allowed).toBe(true);
  });
  it("bounds memory without evicting active protection and cleans expired buckets", () => {
    let now = 0;
    const limiter = new FixedWindowLimiter({ clock: () => now, maxEntries: 1 });
    expect(limiter.check("write", a).allowed).toBe(true);
    expect(limiter.check("write", b).allowed).toBe(false);
    expect(limiter.check("write", a).allowed).toBe(true);
    now = 60000;
    expect(limiter.check("write", b).allowed).toBe(true);
  });
  it("does not reset protections if the wall clock moves backwards", () => {
    let now = 1000;
    const limiter = new FixedWindowLimiter({
      clock: () => now,
      policies: { ai: { global: 1, guest: 1 } },
    });
    limiter.check("ai");
    now = 0;
    expect(limiter.check("ai").allowed).toBe(false);
    now = 60000;
    expect(limiter.check("ai").allowed).toBe(false);
    now = 61000;
    expect(limiter.check("ai").allowed).toBe(true);
  });
});
