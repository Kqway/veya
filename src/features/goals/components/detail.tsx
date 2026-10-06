"use client";
import Link from "next/link";
import { useState } from "react";
import type { GoalDTO } from "../schema";
import { agentApi, useGoalAction, useGoalResource } from "./client";
import {
  Arrow,
  ApprovalPanel,
  DemoNotice,
  ErrorState,
  GoalStatus,
  MoneyProgress,
  Skeleton,
  Timeline,
} from "./primitives";

const terminal = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
export function GoalDetail({
  goalKey,
  approvalKey,
}: {
  goalKey: string;
  approvalKey?: string;
}) {
  const resource = useGoalResource<{ goal: GoalDTO }>(`/goals/${goalKey}`),
    action = useGoalAction();
  const [cancel, setCancel] = useState(false);
  const goal = resource.data?.goal;
  const decide = async (key: string, decision: "approve" | "decline") =>
    action.run(async () => {
      await agentApi(`/goals/${goalKey}/approvals/${key}`, "POST", {
        decision,
      });
      await resource.reload();
    });
  const command = async (type: "pause" | "resume" | "cancel") =>
    action.run(async () => {
      await agentApi(`/goals/${goalKey}/command`, "POST", { type });
      setCancel(false);
      await resource.reload();
    });
  return (
    <section className="goal-detail">
      <Link className="goal-back" href="/">
        <span aria-hidden="true">←</span> Все цели
      </Link>
      <ErrorState
        message={action.error ?? resource.error}
        retry={resource.reload}
      />
      {!goal ? (
        resource.loading ? (
          <Skeleton />
        ) : (
          <div className="goal-empty">
            <h1>Цель недоступна</h1>
            <p>Откройте её в том профиле, где она была создана.</p>
            <Link href="/settings" className="goal-text-button">
              Открыть профиль <Arrow />
            </Link>
          </div>
        )
      ) : (
        <>
          <header className="goal-detail-heading">
            <p className="goal-eyebrow">
              {goal.status === "COMPLETED" ? "Результат" : "Ваша цель"}
              <span className="goal-detail-environment">Демо</span>
            </p>
            <h1>{goal.title}</h1>
            <div className="goal-detail-state">
              <GoalStatus status={goal.status} />
              <span className="goal-updated">
                Последняя активность{" "}
                <time dateTime={goal.updatedAt}>
                  {new Intl.DateTimeFormat("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "numeric",
                    month: "short",
                  }).format(new Date(goal.updatedAt))}
                </time>
              </span>
            </div>
          </header>
          {goal.spec.type === "earn_money" && (
            <MoneyProgress
              confirmed={goal.confirmedAmountMinor}
              target={goal.spec.targetAmountMinor}
              currency={goal.currency}
            />
          )}
          <DemoNotice compact />
          {goal.approvals
            .filter((approval) =>
              approvalKey
                ? approval.publicKey === approvalKey
                : approval.status === "pending",
            )
            .map((approval) => (
              <ApprovalPanel
                key={approval.publicKey}
                approval={approval}
                busy={action.busy}
                onDecision={decide}
              />
            ))}
          {approvalKey &&
            !goal.approvals.some(
              (approval) => approval.publicKey === approvalKey,
            ) && (
              <ErrorState message="Это решение недоступно для данной цели." />
            )}
          <div className="goal-detail-columns">
            <div>
              <section
                className={`goal-now${goal.status === "COMPLETED" ? " goal-now-completed" : ""}`}
              >
                <p className="goal-eyebrow">
                  {goal.status === "COMPLETED" ? "Готово" : "Сейчас"}
                </p>
                <h2>
                  {goal.currentAction ??
                    (goal.status === "COMPLETED"
                      ? "Цель достигнута."
                      : "Проверяю доступные возможности.")}
                </h2>
                {goal.status === "WAITING_EXTERNAL" && (
                  <p className="goal-muted">
                    {goal.failureCode === "COMMUNICATION_LIMIT"
                      ? "Veya продолжит завтра. Лимит можно изменить в настройках автономии."
                      : "Veya продолжит автоматически, когда появится ответ. Вкладку можно закрыть."}
                  </p>
                )}
                {goal.status === "PLANNING" && (
                  <p className="goal-muted">
                    Цель сохранена. Veya подбирает следующие действия. Вкладку
                    можно закрыть.
                  </p>
                )}
                {goal.status === "WAITING_APPROVAL" && (
                  <p className="goal-muted">Продолжу после вашего решения.</p>
                )}
                {goal.status === "PAUSED" && (
                  <p className="goal-muted">
                    Цель сохранена. Возобновите её, когда будете готовы.
                  </p>
                )}
                {["CAPABILITY_UNAVAILABLE", "CONNECTOR_DISABLED"].includes(
                  goal.failureCode ?? "",
                ) && (
                  <Link className="goal-text-button" href="/connections">
                    Проверить возможности <Arrow />
                  </Link>
                )}
                {goal.spec.type === "find_people" && (
                  <Link className="goal-text-button" href="/discover">
                    Открыть людей и встречи <Arrow />
                  </Link>
                )}
              </section>
              {goal.nextActions.length > 0 && !terminal.has(goal.status) && (
                <section className="goal-next">
                  <p className="goal-eyebrow">Дальше</p>
                  <ol>
                    {goal.nextActions.map((next) => (
                      <li key={next}>
                        <Arrow />
                        <span>{next}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {goal.artifacts.length > 0 && (
                <section className="goal-artifacts">
                  <p className="goal-eyebrow">Результаты работы</p>
                  {goal.artifacts.map((artifact) => (
                    <a
                      key={artifact.publicKey}
                      className="goal-artifact"
                      href={`/api/agent/goals/${goalKey}/artifacts/${artifact.publicKey}`}
                    >
                      <span className="goal-artifact-icon" aria-hidden="true">
                        ↳
                      </span>
                      <span>
                        {artifact.title}
                        <small>
                          {artifact.verified ? "Проверено · " : ""}
                          {Math.max(1, Math.round(artifact.byteSize / 1024))} КБ
                        </small>
                      </span>
                      <Arrow diagonal />
                    </a>
                  ))}
                </section>
              )}
            </div>
            <section className="goal-history">
              <div className="goal-section-heading">
                <h2>Ход работы</h2>
                <button
                  type="button"
                  className="goal-text-button"
                  onClick={() => void resource.reload()}
                >
                  Обновить
                </button>
              </div>
              {goal.events.length ? (
                <Timeline events={[...goal.events].reverse()} />
              ) : (
                <p className="goal-muted">
                  Первое событие появится, когда Veya начнёт.
                </p>
              )}
            </section>
          </div>
          {!terminal.has(goal.status) && (
            <div className="goal-process-controls">
              {goal.status === "PAUSED" ? (
                goal.spec.type !== "unsupported" && (
                  <button
                    className="goal-button goal-button-secondary"
                    disabled={action.busy}
                    onClick={() => void command("resume")}
                  >
                    Продолжить <Arrow />
                  </button>
                )
              ) : (
                <button
                  className="goal-text-button"
                  disabled={action.busy}
                  onClick={() => void command("pause")}
                >
                  Приостановить
                </button>
              )}
              <button
                className="goal-text-button goal-danger"
                disabled={action.busy}
                onClick={() => setCancel(true)}
              >
                Остановить цель
              </button>
              {cancel && (
                <div className="goal-cancel">
                  <p>
                    Остановить эту цель? Сохранённые результаты останутся, новые
                    действия прекратятся.
                  </p>
                  <button
                    className="goal-button goal-button-secondary"
                    disabled={action.busy}
                    onClick={() => void command("cancel")}
                  >
                    Да, остановить
                  </button>
                  <button
                    className="goal-text-button"
                    onClick={() => setCancel(false)}
                  >
                    Продолжить работу
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
