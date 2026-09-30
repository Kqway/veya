import { afterEach, describe, expect, it, vi } from "vitest";
import { readJson } from "@/features/backend/http";
afterEach(() => vi.useRealTimers());
describe("bounded incoming JSON", () => {
  it("rejects a stalled upload even when stream cancellation never resolves", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      cancel: () => new Promise(() => {}),
    });
    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    const pending = readJson(request, 25).catch((error) => error);
    await vi.advanceTimersByTimeAsync(25);
    const error = await pending;
    expect(error).toMatchObject({ status: 408, code: "REQUEST_TIMEOUT" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
