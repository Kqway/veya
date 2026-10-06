"use client";
import Link from "next/link";
import { useState } from "react";
import type { AutonomyPolicy } from "../schema";
import { agentApi, useGoalAction, useGoalResource } from "./client";
import { Arrow, ErrorState, GoalPageShell, Skeleton } from "./primitives";

export function GoalAutonomy() {
  const resource = useGoalResource<{ policy: AutonomyPolicy }>("/policy", {
      allowUnbound: true,
    }),
    action = useGoalAction();
  const [limit, setLimit] = useState<number | null>(null),
    [saved, setSaved] = useState(false);
  const save = async () =>
    action.run(async () => {
      await agentApi("/policy", "PATCH", {
        communicationLimit:
          limit ?? resource.data?.policy.communicationLimit ?? 5,
      });
      await resource.reload();
      setSaved(true);
      setLimit(null);
    });
  return (
    <GoalPageShell
      eyebrow="Автономия"
      title="Доверие с границами."
      description="Вы решаете, какие действия Veya может выполнять сама."
    >
      <ErrorState
        message={action.error ?? resource.error}
        retry={resource.reload}
      />
      <section className="goal-policy-section">
        <span className="goal-policy-number">01</span>
        <div>
          <p className="goal-eyebrow">Без подтверждения</p>
          <h2>Исследовать. Подготовить. Проверить.</h2>
          <ul className="goal-policy-list">
            <li>Искать информацию в подключённых источниках</li>
            <li>Анализировать предложения</li>
            <li>Создавать и проверять черновики</li>
          </ul>
        </div>
      </section>
      <section className="goal-policy-section">
        <span className="goal-policy-number">02</span>
        <div>
          <p className="goal-eyebrow">С ограничением</p>
          <h2>Общаться от вашего имени.</h2>
          <p className="goal-muted">
            Только через разрешённые подключения. Лимит общий для всех ваших
            целей.
          </p>
          {resource.loading ? (
            <Skeleton label="Загружаю разрешения…" />
          ) : resource.unbound ? (
            <Link className="goal-text-button" href="/settings">
              Настроить профиль <Arrow />
            </Link>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
              className="goal-limit-form"
            >
              <label htmlFor="communication-limit">
                До{" "}
                <select
                  id="communication-limit"
                  value={limit ?? resource.data?.policy.communicationLimit ?? 5}
                  onChange={(event) => {
                    setLimit(Number(event.target.value));
                    setSaved(false);
                  }}
                  disabled={action.busy}
                >
                  {Array.from({ length: 11 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>{" "}
                сообщений в день
              </label>
              <button
                className="goal-button goal-button-secondary"
                disabled={action.busy || limit === null}
              >
                Сохранить
              </button>
              {saved && (
                <span className="goal-saved" role="status">
                  Сохранено
                </span>
              )}
            </form>
          )}
        </div>
      </section>
      <section className="goal-policy-section">
        <span className="goal-policy-number">03</span>
        <div>
          <p className="goal-eyebrow">Всегда спрашивать</p>
          <h2>Действия с последствиями.</h2>
          <ul className="goal-policy-list goal-policy-list-approval">
            <li>Платежи, счета и покупки</li>
            <li>Юридические соглашения</li>
            <li>Удаление данных</li>
          </ul>
          <p className="goal-muted">
            Каждое разрешение относится к конкретному действию. Эти правила
            нельзя отключить.
          </p>
        </div>
      </section>
    </GoalPageShell>
  );
}
