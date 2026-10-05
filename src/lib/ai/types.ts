import type { z } from "zod";
import type {
  parseInputSchema,
  planContextSchema,
  planIdeaSchema,
  explanationReasonsSchema,
} from "./schemas";
export type { ParsedIntent } from "@/features/intents/structured";
export type { SeekingSuggestion } from "@/features/discovery/seeking-suggestion";
import type { InterpretInput } from "@/features/intent-product/schema";
export type { InterpretInput, Interpretation } from "@/features/intent-product/schema";
export type ParseInput = z.infer<typeof parseInputSchema>;
export type PlanContext = z.infer<typeof planContextSchema>;
export type PlanIdea = z.infer<typeof planIdeaSchema>;
export type ExplanationReasons = z.infer<typeof explanationReasonsSchema>;
export type AiTask = "parse_intent" | "parse_seeking" | "parse_conversation" | "suggest_plan" | "explain_plan";
export interface AiRequest {
  task: AiTask;
  input: ParseInput | PlanContext | InterpretInput;
}
export interface AiProvider {
  readonly name: "mock" | "openai";
  complete(request: AiRequest, signal: AbortSignal): Promise<unknown>;
}
export interface TaskResult<T> {
  data: T;
  source: "mock" | "openai" | "fallback";
}
export interface PlanAssistanceResult {
  suggestionKey: string;
  revision: number;
  idea: TaskResult<PlanIdea>;
  explanation: TaskResult<{ explanation: string }>;
}
