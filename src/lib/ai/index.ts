import "server-only";
import { getServerEnv } from "@/lib/config/server";
import type { ServerEnv } from "@/lib/config/env";
import { AiTasks } from "./tasks";
import { MockAiProvider } from "./mock-provider";
import { OpenAiProvider } from "./openai-provider";
export function createAiTasks(
  config: Pick<ServerEnv, "AI_PROVIDER" | "OPENAI_API_KEY" | "OPENAI_MODEL">,
): AiTasks {
  if (config.AI_PROVIDER === "mock")
    return new AiTasks({ provider: new MockAiProvider() });
  return new AiTasks({
    provider: config.OPENAI_API_KEY
      ? new OpenAiProvider({
          apiKey: config.OPENAI_API_KEY,
          ...(config.OPENAI_MODEL ? { model: config.OPENAI_MODEL } : {}),
        })
      : null,
  });
}
export function getAiTasks(): AiTasks {
  return createAiTasks(getServerEnv());
}
export type {
  AiProvider,
  TaskResult,
  ParsedIntent,
  PlanContext,
  PlanIdea,
  PlanAssistanceResult,
  InterpretInput,
  Interpretation,
} from "./types";
