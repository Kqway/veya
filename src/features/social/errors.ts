export type SocialErrorCode = "INVALID_INPUT" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT";
const descriptions: Record<SocialErrorCode, { status: number; message: string }> = {
  INVALID_INPUT: { status: 400, message: "Проверьте заполненные поля." },
  UNAUTHORIZED: { status: 401, message: "Нужна действующая гостевая сессия." },
  FORBIDDEN: { status: 403, message: "Это действие недоступно." },
  NOT_FOUND: { status: 404, message: "Запрошенные данные недоступны." },
  CONFLICT: { status: 409, message: "Сейчас это действие недоступно." },
};
/** Safe for the HTTP boundary; never includes keys, identifiers or DB errors. */
export class SocialError extends Error {
  readonly status: number;
  constructor(readonly code: SocialErrorCode) {
    super(descriptions[code].message);
    this.name = "SocialError";
    this.status = descriptions[code].status;
  }
}
export function fail(code: SocialErrorCode): never { throw new SocialError(code); }
