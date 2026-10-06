import "server-only";
import type { Database } from "@/lib/db/types";
import type { RequestLimiter } from "@/lib/security/rate-limit";
import {
  assertBetaOperationAllowed,
  getBetaControls,
  type BetaControls,
} from "@/lib/config/beta-policy";
import {
  apiError,
  json,
  HttpError,
  readJson,
  tokenFrom,
  enforceRateLimit,
} from "@/features/backend/http";
import { SocialError } from "@/features/social/errors";
import { GoalService } from "./service";
export function createGoalHandler(options: {
  origin: string;
  db: () => Database;
  limiter?: RequestLimiter;
  getBetaControls?: () => BetaControls;
}) {
  const origin = new URL(options.origin).origin;
  return async (request: Request, path: string[]): Promise<Response> => {
    try {
      const mutation = request.method !== "GET";
      if (mutation && request.headers.get("origin") !== origin)
        throw new HttpError(
          403,
          "ORIGIN_REJECTED",
          "Отправьте запрос с адреса приложения.",
        );
      assertBetaOperationAllowed(
        mutation ? "mutation" : "read",
        options.getBetaControls?.() ?? getBetaControls(),
      );
      await enforceRateLimit(
        options.limiter,
        mutation ? "socialWrite" : "socialRead",
        request,
      );
      const [resource, key, operation, child] = path,
        method = request.method,
        token = tokenFrom(request);
      if (new URL(request.url).search) throw new SocialError("INVALID_INPUT");
      const service = () => new GoalService(options.db());
      if (resource === "goals") {
        if (path.length === 1 && method === "POST")
          return json(
            { goal: await service().create(token, await readJson(request)) },
            201,
          );
        if (path.length === 1 && method === "GET")
          return json({ goals: await service().list(token) });
        if (path.length === 2 && key && method === "GET")
          return json({ goal: await service().get(token, key) });
        if (
          path.length === 3 &&
          key &&
          operation === "command" &&
          method === "POST"
        )
          return json({
            goal: await service().command(token, key, await readJson(request)),
          });
        if (
          path.length === 4 &&
          key &&
          child &&
          operation === "approvals" &&
          method === "POST"
        )
          return json({
            goal: await service().approve(
              token,
              key,
              child,
              await readJson(request),
            ),
          });
        if (
          path.length === 4 &&
          key &&
          child &&
          operation === "artifacts" &&
          method === "GET"
        ) {
          const file = await service().artifact(token, key, child);
          return new Response(file.content, {
            headers: {
              "Content-Type": file.mediaType + "; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              "Content-Disposition": 'attachment; filename="veya-document.md"',
            },
          });
        }
      }
      if (path.length === 1 && resource === "connections") {
        if (method === "GET")
          return json({ connections: await service().connections(token) });
        if (method === "POST" || method === "PATCH")
          return json({
            connections: await service().setConnection(
              token,
              await readJson(request),
            ),
          });
      }
      if (path.length === 1 && resource === "policy") {
        if (method === "GET")
          return json({ policy: await service().policy(token) });
        if (method === "POST" || method === "PATCH")
          return json({
            policy: await service().savePolicy(token, await readJson(request)),
          });
      }
      if (path.length === 1 && resource === "activity" && method === "GET")
        return json({ events: await service().activity(token) });
      throw new SocialError("NOT_FOUND");
    } catch (error) {
      if (error instanceof SocialError)
        return json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      return apiError(error);
    }
  };
}
