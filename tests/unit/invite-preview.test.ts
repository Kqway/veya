import type { DatabaseExecutor } from "@/lib/db/types";
import { describe, expect, it, vi } from "vitest";
import {
  getInvitePreview,
  previewDescription,
  readPublicPreview,
} from "@/features/entry/preview";
const slug = "abcdefghijklmnopqrstuvwx";
describe("public invite preview", () => {
  it("reads only organizer and effective status without participant or private fields", async () => {
    const query = vi.fn(async (...args: unknown[]) => {
      void args;
      return {
        rows: [{ creatorName: "Artem", status: "expired" }],
        rowCount: 1,
      };
    });
    const result = await readPublicPreview(
      { query } as unknown as DatabaseExecutor,
      slug,
    );
    expect(result).toEqual({ creatorName: "Artem", status: "expired" });
    const sql = query.mock.calls[0]![0] as string;
    expect(sql).toContain("creator_display_name");
    expect(sql).toContain("expires_at");
    expect(sql).not.toMatch(
      /participants|raw_text|structured_intent|guest|\bi\.\*|SELECT\s+\*/i,
    );
  });
  it("uses only a public organizer name and fixed copy", async () => {
    const load = vi.fn(async () => ({
      creatorName: "Artem",
      status: "collecting" as const,
      rawText: "PRIVATE IDEA",
      ownParticipant: { notes: "PRIVATE NOTE" },
    }));
    const result = await getInvitePreview(slug, load);
    expect(result).toEqual({
      title: "Artem wants to make a plan 👀",
      description: previewDescription,
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(load).toHaveBeenCalledWith(slug);
  });
  it("keeps invalid, unavailable and closed previews generic", async () => {
    const load = vi.fn(async () => ({
      creatorName: "Secret organizer",
      status: "expired" as const,
    }));
    expect((await getInvitePreview("bad", load)).title).toBe(
      "Your next good time starts here",
    );
    expect(load).not.toHaveBeenCalled();
    expect((await getInvitePreview(slug, load)).title).not.toContain("Secret");
    expect(
      await getInvitePreview(slug, async () => {
        throw new Error("internal db secret");
      }),
    ).toEqual({
      title: "Your next good time starts here",
      description: previewDescription,
    });
  });
});
