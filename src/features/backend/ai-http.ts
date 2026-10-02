import "server-only";
import type { RequestLimiter } from "@/lib/security/rate-limit";
import { z } from "zod";
import type { AiTasks } from "@/lib/ai/tasks";
import type { PlanContext, PlanAssistanceResult } from "@/lib/ai/types";
import { parseInputSchema } from "@/lib/ai/schemas";
import {
  apiError,
  HttpError,
  json,
  readJson,
  tokenFrom,
  enforceRateLimit,
} from "./http";
import { BackendError } from "./errors";
import { validate, slugSchema } from "./validation";
import type { VeyaBackend } from "./service";
import { assertBetaOperationAllowed, getBetaControls, type BetaControls } from "@/lib/config/beta-policy";
const selectionSchema = z
  .object({
    suggestionKey: z.string().regex(/^[a-f0-9]{32}$/),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export function createAiHandlers(options: {
  origin: string;
  tasks: () => AiTasks;
  backend: () => VeyaBackend;
  limiter?: RequestLimiter;
  getBetaControls?: () => BetaControls;
}) {
  const origin = new URL(options.origin).origin;
  function requireOrigin(request: Request) {
    if (request.headers.get("origin") !== origin)
      throw new HttpError(
        403,
        "ORIGIN_REJECTED",
        "Use the application's origin for this request.",
      );
    assertBetaOperationAllowed("mutation", options.getBetaControls?.() ?? getBetaControls());
  }
  async function context(
    backend: VeyaBackend,
    token: string,
    slug: string,
    selection: z.infer<typeof selectionSchema>,
  ): Promise<PlanContext> {
    if (!(await backend.getSession(token)))
      throw new BackendError("UNAUTHORIZED");
    const view = await backend.getResults(slug, token);
    if (!view.isCreator && !view.ownParticipant)
      throw new BackendError("FORBIDDEN");
    const p = view.suggestions.find(
      (p) => p.suggestionKey === selection.suggestionKey,
    );
    if (view.revision !== selection.revision || !p)
      throw new BackendError("STALE_RESULTS");
    // Explicit public projection. Never pass the view or participant records.
    return {
      intent: {
        rawText: view.intent.rawText,
        activities: view.intent.structuredIntent.activities.map((a) =>
          a.toLowerCase(),
        ),
        location: view.intent.structuredIntent.location,
      },
      proposal: {
        startAt: p.window.startAt,
        endAt: p.window.endAt,
        availableCount: p.availableCount,
        partialCount: p.partialCount,
        totalCount: p.totalCount,
        durationMinutes: p.durationMinutes,
        shortened: p.shortened,
        activity: p.activity,
        budgetAssessment: p.budgetAssessment,
      },
    };
  }
  return {
    async parseIntent(request: Request) {
      try {
        requireOrigin(request);
        await enforceRateLimit(options.limiter, "ai", request);
        const input = validate(parseInputSchema, await readJson(request));
        return json(await options.tasks().parseIntent(input));
      } catch (error) {
        return apiError(error);
      }
    },
    async assist(request: Request, slug: string) {
      try {
        requireOrigin(request);
        await enforceRateLimit(options.limiter, "ai", request);
        validate(slugSchema, slug);
        const selection = validate(selectionSchema, await readJson(request)),
          token = tokenFrom(request),
          backend = options.backend();
        const input = await context(backend, token, slug, selection),
          tasks = options.tasks();
        // All database transactions finish before provider work starts.
        const [idea, explanation] = await Promise.all([
          tasks.suggestPlan(input),
          tasks.explainPlan(input),
        ]);
        await context(backend, token, slug, selection);
        const result: PlanAssistanceResult = {
          ...selection,
          idea,
          explanation,
        };
        return json(result);
      } catch (error) {
        return apiError(error);
      }
    },
  };
}
