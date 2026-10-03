export type BackendErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVITE_EXPIRED"
  | "INTENT_CLOSED"
  | "STALE_RESULTS"
  | "PLAN_LIMIT_REACHED";

const messages: Record<BackendErrorCode, string> = {
  PLAN_LIMIT_REACHED:
    "В этом плане достигнут лимит участников или промежутков свободного времени. Уменьшите число временных интервалов или создайте другой план.",
  STALE_RESULTS: "Варианты встречи изменились. Обновите результаты перед выбором.",
  INVALID_INPUT: "Проверьте заполненные поля.",
  UNAUTHORIZED: "Нужна действующая гостевая сессия.",
  FORBIDDEN: "У вас нет разрешения на это действие.",
  NOT_FOUND: "План или участие в нём не найдены.",
  INVITE_EXPIRED: "Срок действия приглашения истёк.",
  INTENT_CLOSED: "Этот план больше нельзя изменить.",
};

export class BackendError extends Error {
  constructor(readonly code: BackendErrorCode) {
    super(messages[code]);
    this.name = "BackendError";
  }
}
