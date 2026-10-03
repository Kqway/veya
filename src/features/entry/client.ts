export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(
      code === "PLAN_LIMIT_REACHED"
        ? "В плане уже слишком много участников или промежутков времени. Выберите меньше промежутков или создайте новый план."
        : code === "RATE_LIMITED"
          ? "Слишком много запросов. Ваши данные сохранены здесь; подождите минуту и попробуйте ещё раз."
          : code === "UNAUTHORIZED"
            ? "Сеанс завершён. Обновите страницу, чтобы продолжить."
            : code === "STALE_RESULTS"
              ? "Варианты встречи изменились. Обновите результаты перед выбором."
              : code === "INVITE_EXPIRED"
                ? "Срок приглашения истёк. Создайте новый совместный план."
                : code === "INTENT_CLOSED"
                  ? "Этот план больше нельзя изменить."
                  : code === "INVALID_INPUT"
                    ? "Проверьте данные и свободное время в будущем, затем попробуйте ещё раз."
                    : "Не удалось сохранить изменения. Ваши данные остались здесь — попробуйте ещё раз.",
    );
  }
}

export async function requestApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
  options: { keepalive?: boolean } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      ...(options.keepalive ? { keepalive: true } : {}),
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
