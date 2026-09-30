import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ensureGuest, requestApi } from "@/features/entry/client";
afterEach(() => vi.unstubAllGlobals());
describe("guest browser API", () => {
  it("uses only HttpOnly cookie transport and an empty session body", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{"authenticated":true}'));
    vi.stubGlobal("fetch", fetcher);
    await ensureGuest();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/session",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });
  it("preserves safe status/code and handles non-JSON or failed networks", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":{"code":"UNAUTHORIZED","message":"No"}}', {
            status: 401,
          }),
        ),
    );
    await expect(requestApi("/api/intents")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("gateway failure", { status: 502 })),
    );
    await expect(requestApi("/api/intents")).rejects.toBeInstanceOf(ApiError);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(requestApi("/api/intents")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
});
