import { z } from "zod";
import type { AiProvider, TextGenerationInput, TextGenerationResult } from "./types";

const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
});

/** Local echo adapter: validates the contract without pretending to call AI. */
export class MockAiProvider implements AiProvider {
  async generateText(input: TextGenerationInput): Promise<TextGenerationResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) throw new Error("Invalid AI prompt: use 1–4000 characters.");
    return { text: parsed.data.prompt, provider: "mock" };
  }
}
