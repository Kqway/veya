export interface TextGenerationInput {
  prompt: string;
}

export interface TextGenerationResult {
  text: string;
  provider: "mock" | "openai";
}

/** Structured intent tasks and remote provider integration arrive in Phase 5. */
export interface AiProvider {
  generateText(input: TextGenerationInput): Promise<TextGenerationResult>;
}
