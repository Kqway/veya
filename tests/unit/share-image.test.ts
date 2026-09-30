import { afterEach, describe, expect, it, vi } from "vitest";
import { shareImage } from "@/components/share-image";
import { previewDescription } from "@/features/entry/preview";
afterEach(() => vi.unstubAllGlobals());
describe("offline-safe share images", () => {
  it.each(["🇺🇦", "1️⃣", "张伟", "محمد"])(
    "renders %s names without any external assets",
    async (name) => {
      const localFetch = globalThis.fetch;
    const network = vi.fn(async () => {
        throw new Error("External assets forbidden");
      });
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("data:") ? localFetch(input, init) : network());
      const bytes = new Uint8Array(
        await shareImage({
          title: `${name} wants to make a plan 👀`,
          description: previewDescription,
        }).arrayBuffer(),
      );
      expect(bytes.slice(0, 8)).toEqual(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(bytes.byteLength).toBeGreaterThan(1000);
      expect(network).not.toHaveBeenCalled();
    },
  );
});
