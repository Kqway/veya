import "server-only";
import { getServerEnv } from "@/lib/config/server";
import { MockAiProvider } from "./mock-provider";
import type { AiProvider } from "./types";

export function getAiProvider(): AiProvider {
  getServerEnv(); // Validate the selected provider; Phase 1 supports mock only.
  return new MockAiProvider();
}

export type { AiProvider, TextGenerationInput, TextGenerationResult } from "./types";
