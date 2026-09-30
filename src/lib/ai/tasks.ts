import "server-only";
import type { z } from "zod";
import {
  parsedIntentSchema,
  type ParsedIntent,
} from "@/features/intents/structured";
import { MockAiProvider } from "./mock-provider";
import {
  parseInputSchema,
  planContextSchema,
  planIdeaSchema,
  explanationReasonsSchema,
  applicableReasons,
  renderReasons,
} from "./schemas";
import type { AiProvider, AiRequest, PlanIdea, TaskResult } from "./types";
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
  async parseIntent(input: unknown): Promise<TaskResult<ParsedIntent>> {
    const data = parseInputSchema.parse(input);
    return this.run({ task: "parse_intent", input: data }, parsedIntentSchema);
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
