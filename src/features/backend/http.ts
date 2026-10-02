import "server-only";
import type { RequestLimiter, RateAction } from "@/lib/security/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { VeyaBackend } from "./service";
import { BackendError } from "./errors";
import { GUEST_COOKIE } from "./sessions";
import { validate } from "./validation";
import { logOperationalEvent } from "@/lib/logging/server";
import { assertBetaOperationAllowed, BetaPolicyError, getBetaControls, type BetaControls, type BetaOperation } from "@/lib/config/beta-policy";

export interface BackendHttpOptions {
  backend: () => VeyaBackend;
  origin: string;
  secureCookie: boolean;
  limiter?: RequestLimiter;
  getBetaControls?: () => BetaControls;
}
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function tokenFrom(request: Request): string {
  for (const cookie of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = cookie.indexOf("=");
    if (cookie.slice(0, separator).trim() === GUEST_COOKIE) {
      try {
        return decodeURIComponent(cookie.slice(separator + 1));
      } catch {
        return "";
      }
    }
  }
  return "";
}

export async function enforceRateLimit(
  limiter: RequestLimiter | undefined,
  action: RateAction,
  request: Request,
): Promise<void> {
  const decision = await limiter?.check(action, tokenFrom(request));
  if (decision && !decision.allowed)
    throw new HttpError(
      429,
      "RATE_LIMITED",
      "Too many requests. Wait a little and try again.",
      decision.retryAfterSeconds,
    );
}

export async function readJson(
  request: Request,
  timeoutMs = 5000,
): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json.");
  const tooLarge = () =>
    new HttpError(413, "BODY_TOO_LARGE", "The request body exceeds 16 KiB.");
  if (Number(request.headers.get("content-length")) > 16384) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError(400, "INVALID_JSON", "Provide a valid JSON body.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const consume = async () => {
    let size = 0,
      text = "";
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16384) {
          void reader.cancel().catch(() => {});
          throw tooLarge();
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  };
  try {
    const text = await Promise.race([
      consume(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new HttpError(
              408,
              "REQUEST_TIMEOUT",
              "The request took too long. Please try again.",
            ),
          );
          void reader.cancel().catch(() => {});
        }, timeoutMs);
      }),
    ]);
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, "INVALID_JSON", "Provide a valid JSON body.");
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createBackendHandlers(options: BackendHttpOptions) {
  const allowedOrigin = new URL(options.origin).origin;
  const cookieSettings = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: options.secureCookie,
    path: "/",
  };

  async function handle(
    work: () => Promise<NextResponse>,
  ): Promise<NextResponse> {
    try {
      return await work();
    } catch (error) {
      return apiError(error);
    }
  }

  async function requireOrigin(request: Request, action: RateAction = "write", operation: BetaOperation = "mutation") {
    if (request.headers.get("origin") !== allowedOrigin)
      throw new HttpError(
        403,
        "ORIGIN_REJECTED",
        "Use the application's origin for this request.",
      );
    assertBetaOperationAllowed(operation, options.getBetaControls?.() ?? getBetaControls());
    await enforceRateLimit(options.limiter, action, request);
  }

  return {
    getResults(request: Request, slug: string) {
      return handle(async () => {
        await enforceRateLimit(options.limiter, "read", request);
        return json(
          await options.backend().getResults(slug, tokenFrom(request), {readOnly: (options.getBetaControls?.() ?? getBetaControls()).readOnly}),
        );
      });
    },
    vote(request: Request, slug: string) {
      return handle(async () => {
        await requireOrigin(request);
        const input = await readJson(request);
        return json(
          await options.backend().vote(tokenFrom(request), slug, input),
        );
      });
    },
    decide(request: Request, slug: string) {
      return handle(async () => {
        await requireOrigin(request);
        const input = await readJson(request);
        return json(
          await options.backend().decide(tokenFrom(request), slug, input),
        );
      });
    },
    createSession(request: Request) {
      return handle(async () => {
        await requireOrigin(request, "session");
        validate(z.object({}).strict(), await readJson(request));
        const backend = options.backend();
        const active = await backend.getSession(tokenFrom(request));
        if (active)
          return json({ authenticated: true, expiresAt: active.expiresAt });
        const guest = await backend.createSession();
        const response = json(
          { authenticated: true, expiresAt: guest.expiresAt },
          201,
        );
        response.cookies.set(GUEST_COOKIE, guest.token, {
          ...cookieSettings,
          expires: new Date(guest.expiresAt),
        });
        return response;
      });
    },
    revokeSession(request: Request) {
      return handle(async () => {
        await requireOrigin(request, "session", "safety");
        await options.backend().revokeSession(tokenFrom(request));
        const response = json({ authenticated: false });
        response.cookies.set(GUEST_COOKIE, "", {
          ...cookieSettings,
          maxAge: 0,
          expires: new Date(0),
        });
        return response;
      });
    },
    createIntent(request: Request) {
      return handle(async () => {
        await requireOrigin(request, "create");
        const input = await readJson(request);
        return json(
          await options.backend().createIntent(tokenFrom(request), input),
          201,
        );
      });
    },
    getIntent(request: Request, slug: string) {
      return handle(async () => {
        await enforceRateLimit(options.limiter, "read", request);
        return json(
          await options.backend().getIntent(slug, tokenFrom(request)),
        );
      });
    },
    joinIntent(request: Request, slug: string) {
      return handle(async () => {
        await requireOrigin(request, "join");
        const input = await readJson(request);
        const result = await options
          .backend()
          .joinIntent(tokenFrom(request), slug, input);
        return json(result.view, result.created ? 201 : 200);
      });
    },
    updateParticipant(request: Request, slug: string) {
      return handle(async () => {
        await requireOrigin(request);
        const input = await readJson(request);
        return json(
          await options
            .backend()
            .updateParticipant(tokenFrom(request), slug, input),
        );
      });
    },
    closeIntent(request: Request, slug: string) {
      return handle(async () => {
        await requireOrigin(request);
        await options.backend().closeIntent(tokenFrom(request), slug);
        return json({ closed: true });
      });
    },
  };
}

/** Shared safe response boundary for core and optional APIs. */
export function apiError(error: unknown): NextResponse {
  if (error instanceof BetaPolicyError)
    return json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof HttpError) {
    const response = json(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
    if (error.retryAfterSeconds)
      response.headers.set(
        "Retry-After",
        String(Math.max(1, Math.ceil(error.retryAfterSeconds))),
      );
    return response;
  }
  if (error instanceof BackendError) {
    const statuses = {
      INVALID_INPUT: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      INVITE_EXPIRED: 410,
      INTENT_CLOSED: 409,
      STALE_RESULTS: 409,
      PLAN_LIMIT_REACHED: 409,
    };
    return json(
      { error: { code: error.code, message: error.message } },
      statuses[error.code],
    );
  }
  logOperationalEvent("api_unavailable");
  return json(
    {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The service is temporarily unavailable.",
      },
    },
    503,
  );
}
