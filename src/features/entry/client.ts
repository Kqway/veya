export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(
      code === "UNAUTHORIZED"
        ? "Your session has ended. Reload this page to continue."
        : code === "INVITE_EXPIRED"
          ? "This invite has expired. Start a new plan together."
          : code === "INTENT_CLOSED"
            ? "This plan is closed to changes."
            : code === "INVALID_INPUT"
              ? "Check your details and future availability, then try again."
              : "We couldn't save that right now. Your details are still here — please try again.",
    );
  }
}

export async function requestApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal: AbortSignal.timeout(15_000),
      credentials: "same-origin",
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new ApiError("NETWORK_ERROR", 0);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE", response.status);
  }
  if (!response.ok) {
    const error = data as { error?: { code?: string } };
    throw new ApiError(
      error?.error?.code ?? "SERVICE_UNAVAILABLE",
      response.status,
    );
  }
  return data as T;
}

export async function ensureGuest(): Promise<void> {
  await requestApi("/api/session", "POST", {});
}
