import Link from "next/link";
import type { ReactNode } from "react";
import type {
  GoalDTO,
  GoalStatus as Status,
  GoalEventDTO,
  GoalApprovalDTO,
} from "../schema";

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className={diagonal ? "goal-arrow-diagonal" : undefined}
    >
      <path
        d="M4 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export const statusLabels: Record<Status, string> = {
  DRAFT: "Черновик",
  PLANNING: "Планирую",
  ACTIVE: "Работаю",
  WAITING_EXTERNAL: "Ожидаю",
  WAITING_APPROVAL: "Нужно ваше решение",
  PAUSED: "На паузе",
  COMPLETED: "Готово",
  FAILED: "Нужна помощь",
  CANCELLED: "Остановлено",
};
export function GoalStatus({ status }: { status: Status }) {
  return (
    <span
      className={`goal-status goal-status-${status.toLowerCase()}`}
      role="status"
    >
      <span className="goal-status-dot" />
      {statusLabels[status]}
    </span>
  );
}
export function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: amountMinor % 100 ? 2 : 0,
  }).format(amountMinor / 100);
}
export function DemoNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`goal-demo${compact ? " goal-demo-compact" : ""}`}>
      <span className="goal-demo-label">Демо-среда</span>
      {compact
        ? "Симулированные клиенты и платежи."
        : "Клиенты и платежи симулируются. Реальные деньги не перемещаются."}
    </p>
  );
}
export function MoneyProgress({
  confirmed,
  target,
  currency,
  compact = false,
}: {
  confirmed: number;
  target: number;
  currency: string;
  compact?: boolean;
}) {
  const percent =
    target > 0
      ? Math.min(100, Math.max(0, Math.round((confirmed / target) * 100)))
      : 0;
  return (
    <div className={`goal-money${compact ? " goal-money-compact" : ""}`}>
      <div>
        <span className="goal-money-value">{money(confirmed, currency)}</span>
        <span className="goal-money-target">из {money(target, currency)}</span>
      </div>
      <div
        className="goal-progress"
        role="progressbar"
        aria-label="Подтверждённый результат"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
export function GoalCard({ goal }: { goal: GoalDTO }) {
  return (
    <Link href={`/goals/${goal.publicKey}`} className="goal-card">
      <div className="goal-card-title">
        <h3>{goal.title}</h3>
        <GoalStatus status={goal.status} />
      </div>
      {goal.spec.type === "earn_money" ? (
        <MoneyProgress
          compact
          confirmed={goal.confirmedAmountMinor}
          target={goal.spec.targetAmountMinor}
          currency={goal.currency}
        />
      ) : (
        <p className="goal-muted">
          {goal.currentAction ?? "Проверяю доступные возможности."}
        </p>
      )}
      <span className="goal-card-open">
        Открыть <Arrow />
      </span>
    </Link>
  );
}
export function Timeline({ events }: { events: GoalEventDTO[] }) {
  return (
    <ol className="goal-timeline">
      {events.map((event, index) => (
        <li
          key={event.publicKey}
          className={index === events.length - 1 ? "goal-timeline-latest" : ""}
        >
          <span className="goal-timeline-marker" aria-hidden="true">
            {event.evidenceRef ? "✓" : "·"}
          </span>
          <div>
            <p>{event.description}</p>
            <time dateTime={event.createdAt}>
              {new Intl.DateTimeFormat("ru-RU", {
                hour: "2-digit",
                minute: "2-digit",
                day: "numeric",
                month: "short",
              }).format(new Date(event.createdAt))}
            </time>
            {event.goalKey && (
              <Link
                className="goal-text-button"
                href={`/goals/${event.goalKey}`}
              >
                Открыть цель <Arrow />
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
export function ApprovalPanel({
  approval,
  busy,
  onDecision,
}: {
  approval: GoalApprovalDTO;
  busy: boolean;
  onDecision: (key: string, decision: "approve" | "decline") => Promise<void>;
}) {
  return (
    <section className="goal-approval" aria-label="Нужно ваше решение">
      <div className="goal-approval-heading">
        <span className="goal-approval-symbol" aria-hidden="true">
          ↗
        </span>
        <p className="goal-eyebrow">
          {approval.status === "pending"
            ? "Нужно ваше решение"
            : approval.status === "approved"
              ? "Действие одобрено"
              : approval.status === "expired"
                ? "Срок решения истёк"
                : "Действие отклонено"}
        </p>
      </div>
      <h2>
        {["create_invoice", "invoice"].includes(approval.action)
          ? "Выставить демо-счёт"
          : "Подтвердить действие"}
      </h2>
      <p>{approval.description}</p>
      {approval.amountMinor !== undefined && approval.currency && (
        <dl>
          <dt>Сумма</dt>
          <dd>{money(approval.amountMinor, approval.currency)}</dd>
        </dl>
      )}
      <p className="goal-muted">
        Разрешение относится только к этому действию. Реальные деньги не
        перемещаются.
      </p>
      {approval.status === "pending" ? (
        <div className="goal-actions">
          <button
            className="goal-button"
            disabled={busy}
            onClick={() => void onDecision(approval.publicKey, "approve")}
          >
            Разрешить <Arrow />
          </button>
          <button
            className="goal-button goal-button-secondary"
            disabled={busy}
            onClick={() => void onDecision(approval.publicKey, "decline")}
          >
            Отклонить
          </button>
        </div>
      ) : (
        <p className="goal-muted">
          {approval.status === "approved"
            ? "Вы разрешили это действие."
            : approval.status === "expired"
              ? "Срок решения истёк."
              : "Вы отклонили это действие."}
        </p>
      )}
    </section>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string | null;
  retry?: () => Promise<void>;
}) {
  return message ? (
    <div className="goal-error">
      <p role="alert">{message}</p>
      {retry && (
        <button className="goal-text-button" onClick={() => void retry()}>
          Попробовать ещё раз <Arrow />
        </button>
      )}
    </div>
  ) : null;
}
export function Skeleton({ label = "Загружаю цель…" }: { label?: string }) {
  return (
    <div className="goal-skeleton" role="status" aria-label={label}>
      <span />
      <span />
      <span />
      <p>{label}</p>
    </div>
  );
}
export function GoalPageShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="goal-page">
      <header className="goal-page-heading">
        <p className="goal-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="goal-page-description">{description}</p>}
      </header>
      {children}
    </section>
  );
}
