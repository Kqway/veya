import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("bounded application shutdown", () => {
  it("starts every resource cleanup even if one fails", async () => {
    const { drainResources } = await import("@/lib/logging/shutdown");
    const released: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    await drainResources([
      async () => { released.push("listen"); throw new Error("private credentials"); },
      async () => { released.push("pool"); },
    ]);
    expect(released.sort()).toEqual(["listen", "pool"]);
  });
  it("finishes within the grace bound when a cleanup stalls", async () => {
    vi.useFakeTimers();
    const { drainResources } = await import("@/lib/logging/shutdown");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const cleanup = drainResources([() => new Promise<void>(() => {})], 50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(cleanup).resolves.toBeUndefined();
  });
});
