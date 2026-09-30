import { describe, expect, it } from "vitest";
import { MockAiProvider } from "@/lib/ai/mock-provider";

describe("mock AI boundary", () => {
  it("returns deterministic output with no credentials or network", async () => {
    const provider = new MockAiProvider();
    const result = await provider.generateText({ prompt: "  Meet friends  " });
    expect(result).toEqual({ text: "Meet friends", provider: "mock" });
    expect(await provider.generateText({ prompt: "  Meet friends  " })).toEqual(result);
  });

  it("rejects blank prompts", async () => {
    await expect(new MockAiProvider().generateText({ prompt: "   " })).rejects.toThrow("prompt");
  });

  it("rejects oversized prompts before any provider work", async () => {
    await expect(new MockAiProvider().generateText({ prompt: "a".repeat(4_001) })).rejects.toThrow("prompt");
  });
});
