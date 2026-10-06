import { goalPlanningInputSchema } from "@/features/goals/ai-plan";
import { rollingPlanSchema, planNext } from "@/features/goals/planner";
import "server-only";
import type { z } from "zod";
import { interpretConversation } from "@/features/intent-product/parser";
import {
  interpretInputSchema,
  interpretationSchema,
  type InterpretInput,
  type Interpretation,
} from "@/features/intent-product/schema";
import {
  parsedIntentSchema,
  type ParsedIntent,
} from "@/features/intents/structured";
import {
  seekingSuggestionSchema,
  type SeekingSuggestion,
} from "@/features/discovery/seeking-suggestion";
import { MockAiProvider } from "./mock-provider";
import {
  parseInputSchema,
  planContextSchema,
  planIdeaSchema,
  explanationReasonsSchema,
  applicableReasons,
  renderReasons,
  conversationTextSchema,
} from "./schemas";
import type { AiProvider, AiRequest, PlanIdea, TaskResult } from "./types";

/** AI may normalize an activity phrase, but cannot supply critical search conditions. */
function normalizeConversation(
  input: InterpretInput,
  text: string,
): Interpretation {
  const original = interpretConversation(input);
  if (text === input.text) return original;
  const ownNumbers = new Set(input.text.match(/\d+/g) ?? []);
  if ((text.match(/\d+/g) ?? []).some((number) => !ownNumbers.has(number)))
    throw new Error("Unsupported conversation normalization.");
  const normalized = interpretConversation({ ...input, text });
  if (
    original.kind === "command" ||
    original.kind === "preference" ||
    normalized.kind === "command" ||
    normalized.kind === "preference"
  ) {
    if (JSON.stringify(original) !== JSON.stringify(normalized))
      throw new Error("Unsupported conversation action.");
    return original;
  }
  const own =
    original.kind === "draft" ? original.draft : original.partialDraft;
  const suggested =
    normalized.kind === "draft" ? normalized.draft : normalized.partialDraft;
  if (!own || !suggested) throw new Error("Missing own conversation draft.");
  const unchanged = (before: unknown, after: unknown) =>
    JSON.stringify(before) === JSON.stringify(after);
  if (
    !unchanged(own.seeking.availability, suggested.seeking.availability) ||
    !unchanged(own.seeking.city, suggested.seeking.city) ||
    !unchanged(own.attributes, suggested.attributes) ||
    own.neededPeople !== suggested.neededPeople ||
    own.existingPeople !== suggested.existingPeople ||
    (own.seeking.activityKey &&
      own.seeking.activityKey !== suggested.seeking.activityKey) ||
    (own.seeking.interactionMode &&
      own.seeking.interactionMode !== suggested.seeking.interactionMode)
  )
    throw new Error("Unsupported conversation conditions.");
  for (const key of [
    "area",
    "skill",
    "languages",
    "tags",
    "desiredAgeBands",
  ] as const)
    if (
      own.seeking[key] !== undefined &&
      !unchanged(own.seeking[key], suggested.seeking[key])
    )
      throw new Error("Unsupported conversation conditions.");
  suggested.seeking.rawText = input.text;
  return interpretationSchema.parse(normalized);
}
export class AiTasks {
  private readonly fallback = new MockAiProvider();
  private readonly provider: AiProvider | null;
  private readonly timeoutMs: number;
  constructor(
    options: { provider?: AiProvider | null; timeoutMs?: number } = {},
  ) {
    this.provider = options.provider ?? null;
    this.timeoutMs = options.timeoutMs ?? 8000;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 8000
    )
      throw new Error("Invalid AI deadline.");
  }
  private async run<T>(
    request: AiRequest,
    schema: z.ZodType<T>,
    check: (data: T) => void = () => {},
  ): Promise<TaskResult<T>> {
    if (this.provider) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("AI deadline exceeded."));
          }, this.timeoutMs);
        });
        const output = await Promise.race([
          this.provider.complete(request, controller.signal),
          deadline,
        ]);
        const data = schema.parse(output);
        check(data);
        return { data, source: this.provider.name };
      } catch {
        // Provider details, keys and prompts never leave this boundary.
      } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
      }
    }
    const data = schema.parse(
      await this.fallback.complete(request, new AbortController().signal),
    );
    check(data);
    return { data, source: "fallback" };
  }
  async planGoal(input: unknown) {
    const data = goalPlanningInputSchema.parse(input);
    const canonical = planNext(data.next, data.revision);
    const result = await this.run(
      { task: "plan_goal", input: data },
      rollingPlanSchema,
      (output) => {
        if (
          output.steps.some(
            (step, index) => step.tool !== canonical[index]?.tool,
          )
        )
          throw new Error("Unsupported action sequence");
      },
    );
    // Model text is advisory and cannot introduce authority into owner-facing state.
    return {
      data: { steps: canonical.slice(0, result.data.steps.length) },
      source: result.source,
    };
  }
  async parseIntent(input: unknown): Promise<TaskResult<ParsedIntent>> {
    const data = parseInputSchema.parse(input);
    return this.run({ task: "parse_intent", input: data }, parsedIntentSchema);
  }
  async interpretConversation(
    input: unknown,
  ): Promise<TaskResult<Interpretation>> {
    const data = interpretInputSchema.parse(input);
    let interpretation = interpretConversation(data);
    const result = await this.run(
      { task: "parse_conversation", input: data },
      conversationTextSchema,
      (output) => {
        interpretation = normalizeConversation(data, output.text);
      },
    );
    return { data: interpretation, source: result.source };
  }
  async parseSeeking(input: unknown): Promise<TaskResult<SeekingSuggestion>> {
    const data = parseInputSchema.parse(input);
    return this.run(
      { task: "parse_seeking", input: data },
      seekingSuggestionSchema,
    );
  }
  async suggestPlan(input: unknown): Promise<TaskResult<PlanIdea>> {
    const data = planContextSchema.parse(input);
    return this.run({ task: "suggest_plan", input: data }, planIdeaSchema);
  }
  async explainPlan(
    input: unknown,
  ): Promise<TaskResult<{ explanation: string }>> {
    const data = planContextSchema.parse(input),
      allowed = applicableReasons(data);
    const result = await this.run(
      { task: "explain_plan", input: data },
      explanationReasonsSchema,
      (output) => {
        if (
          new Set(output.reasons).size !== output.reasons.length ||
          output.reasons.some((reason) => !allowed.includes(reason))
        )
          throw new Error("Unsupported explanation reasons.");
      },
    );
    return {
      data: { explanation: renderReasons(data, result.data.reasons) },
      source: result.source,
    };
  }
}
