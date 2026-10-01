import "server-only";
import { z } from "zod";
import type { Database } from "@/lib/db/types";
import type { AiTasks } from "@/lib/ai/tasks";
import { parseInputSchema } from "@/lib/ai/schemas";
import type { RequestLimiter, RateAction } from "@/lib/security/rate-limit";
import {
  apiError,
  HttpError,
  json,
  readJson,
  tokenFrom,
  enforceRateLimit,
} from "@/features/backend/http";
import { validate } from "@/features/backend/validation";
import { IdentityService } from "./identity";
import { SeekingService } from "./seeking";
import { DiscoveryService } from "./discovery";
import { ConnectionsService } from "./connections";
import { ConversationService } from "./conversations";
import { PlanningService } from "./planning";
import { SafetyService } from "./safety";
import { SocialError } from "./errors";
import { publicKeySchema } from "./seeking-schema";
export function createSocialHandler(options: {
  origin: string;
  db: () => Database;
  tasks: () => AiTasks;
  limiter?: RequestLimiter;
  analyticsEnabled?: boolean;
}) {
  const origin = new URL(options.origin).origin;
  return async (request: Request, path: string[]) => {
    try {
      const mutation = request.method !== "GET";
      if (mutation && request.headers.get("origin") !== origin)
        throw new HttpError(
          403,
          "ORIGIN_REJECTED",
          "Use the application origin.",
        );
      let action: RateAction = mutation ? "socialWrite" : "socialRead";
      const [resource, key, operation] = path;
      if (resource === "discover") action = "discovery";
      if (
        resource === "profile" &&
        (request.method === "POST" || key === "key" || key === "recover")
      )
        action = "recovery";
      if (resource === "profile" && path.length === 1 && request.method === "POST") action = "profileCreate";
      if (resource === "seeking" && request.method === "POST")
        action = "seekingCreate";
      if (resource === "connections" && mutation) action = "connection";
      if (resource === "matches" && operation === "messages" && mutation)
        action = "message";
      if (resource === "reports") action = "report";
      if (resource === "ai") action = "ai";
      await enforceRateLimit(options.limiter, action, request);
      if (path.length > 3) throw new SocialError("NOT_FOUND");
      const token = tokenFrom(request);
      const method = request.method;
      const body = async () => readJson(request);
      const empty = async () => validate(z.object({}).strict(), await body());
      if (
        resource === "ai" &&
        key === "seeking" &&
        path.length === 2 &&
        method === "POST"
      )
        return json(
          await options
            .tasks()
            .parseSeeking(validate(parseInputSchema, await body())),
        );
      // Construct the database boundary only after rate/origin checks and validated route dispatch.
      const db = () => options.db();
      if (resource === "profile" && path.length === 1) {
        if (method === "GET")
          return json({ profile: await new IdentityService(db()).get(token) });
        if (method === "POST") {
          const input = await body();
          return json(
            await new IdentityService(db()).create(token, input),
            201,
          );
        }
        if (method === "PATCH") {
          const input = await body();
          return json({
            profile: await new IdentityService(db()).update(token, input),
          });
        }
      }
      if (resource === "profile" && path.length === 2) {
        if (key === "recover" && method === "POST") {
          const input = await body();
          return json(await new IdentityService(db()).recover(token, input));
        }
        if (key === "key" && method === "POST") {
          await empty();
          return json(await new IdentityService(db()).rotate(token));
        }
        if (key === "key" && method === "DELETE")
          return json(await new IdentityService(db()).revokeKey(token));
      }
      if (resource === "seeking") {
        if (path.length === 1 && method === "GET")
          return json({ posts: await new SeekingService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).list(token) });
        if (path.length === 1 && method === "POST") {
          const input = await body();
          return json(await new SeekingService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).create(token, input), 201);
        }
        if (path.length === 2 && key && method === "GET")
          return json(await new SeekingService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).get(token, key));
        if (path.length === 2 && key && method === "DELETE")
          return json(await new SeekingService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).close(token, key));
      }
      if (resource === "discover") {
        if (path.length === 1 && method === "GET") {
          const params = validate(
            z.object({ source: publicKeySchema }).strict(),
            Object.fromEntries(new URL(request.url).searchParams),
          );
          return json({
            cards: await new DiscoveryService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).discover(
              token,
              params.source,
            ),
          });
        }
        if (
          path.length === 3 &&
          key &&
          operation === "pass" &&
          method === "POST"
        ) {
          await empty();
          return json(await new DiscoveryService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).pass(token, key));
        }
      }
      if (resource === "connections") {
        if (path.length === 1 && method === "GET")
          return json({
            requests: await new ConnectionsService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).list(token),
          });
        if (path.length === 1 && method === "POST") {
          const input = await body();
          return json(await new ConnectionsService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).request(token, input));
        }
        if (
          path.length === 3 &&
          key &&
          operation === "respond" &&
          method === "POST"
        ) {
          const input = await body();
          return json(
            await new ConnectionsService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).respond(token, key, input),
          );
        }
      }
      if (resource === "matches") {
        if (path.length === 1 && method === "GET")
          return json({
            matches: await new ConversationService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).list(token),
          });
        if (path.length === 2 && key && method === "GET")
          return json(await new ConversationService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).get(token, key));
        if (path.length === 3 && key && operation === "messages") {
          if (method === "GET") {
            const q = validate(
              z
                .object({
                  before: publicKeySchema.optional(),
                  limit: z
                    .string()
                    .regex(/^\d{1,2}$/)
                    .optional(),
                })
                .strict(),
              Object.fromEntries(new URL(request.url).searchParams),
            );
            return json(
              await new ConversationService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).messages(token, key, {
                ...(q.before ? { before: q.before } : {}),
                ...(q.limit ? { limit: Number(q.limit) } : {}),
              }),
            );
          }
          if (method === "POST") {
            const input = await body();
            return json(
              await new ConversationService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).send(token, key, input),
              201,
            );
          }
        }
        if (
          path.length === 3 &&
          key &&
          operation === "disclosures" &&
          method === "POST"
        ) {
          const input = await body();
          return json(
            await new ConversationService(db(), {analyticsEnabled: options.analyticsEnabled ?? false}).disclose(token, key, input),
          );
        }
        if (
          path.length === 3 &&
          key &&
          operation === "plan" &&
          method === "POST"
        ) {
          await empty();
          return json(
            await new PlanningService(db(), {
              analyticsEnabled: options.analyticsEnabled ?? false,
            }).plan(token, key),
          );
        }
      }
      if (resource === "block" && path.length === 1 && method === "POST") {
        const input = await body();
        return json(await new SafetyService(db()).block(token, input));
      }
      if (resource === "reports" && path.length === 1 && method === "POST") {
        const input = await body();
        return json(await new SafetyService(db()).report(token, input));
      }
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
