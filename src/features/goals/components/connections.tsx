"use client";
import Link from "next/link";
import type { ConnectionDTO } from "../schema";
import { agentApi, useGoalAction, useGoalResource } from "./client";
import {
  Arrow,
  DemoNotice,
  ErrorState,
  GoalPageShell,
  Skeleton,
} from "./primitives";

export function GoalConnections() {
  const resource = useGoalResource<{ connections: ConnectionDTO[] }>(
      "/connections",
      { allowUnbound: true },
    ),
    action = useGoalAction();
  const change = async (enabled: boolean) =>
    action.run(async () => {
      await agentApi("/connections", "POST", { enabled });
      await resource.reload();
    });
  return (
    <GoalPageShell
      eyebrow="Способности"
      title="Что Veya умеет использовать"
      description="Каждое подключение открывает возможность действовать."
    >
      <DemoNotice compact />
      <ErrorState
        message={action.error ?? resource.error}
        retry={resource.reload}
      />
      {resource.loading ? (
        <Skeleton label="Загружаю подключения…" />
      ) : resource.unbound ? (
        <div className="goal-empty">
          <p>Подключения связаны с вашим профилем.</p>
          <Link className="goal-text-button" href="/settings">
            Создать или восстановить профиль <Arrow />
          </Link>
        </div>
      ) : (
        <div className="goal-connections">
          {resource.data?.connections.map((connection, index) => (
            <section className="goal-connection" key={connection.id}>
              <div className="goal-connection-mark" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div>
                <h2>{connection.name}</h2>
                <p className="goal-muted">{connection.description}</p>
                {connection.environment === "demo" && (
                  <span className="goal-small-label">Демо-среда</span>
                )}
              </div>
              <div className="goal-connection-control">
                {connection.available ? (
                  <>
                    <span
                      className={`goal-connection-state${connection.enabled ? " is-connected" : ""}`}
                    >
                      <span />
                      {connection.enabled ? "Подключено" : "Отключено"}
                    </span>
                    <button
                      className="goal-text-button"
                      disabled={action.busy}
                      onClick={() => void change(!connection.enabled)}
                    >
                      {connection.enabled ? "Отключить" : "Подключить"}
                    </button>
                  </>
                ) : (
                  <span className="goal-muted">Не подключено</span>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="goal-footnote">
        Реальные подключения появятся после настройки соответствующих
        интеграций. Veya не имеет доступа к вашей почте, календарю или GitHub.
      </p>
    </GoalPageShell>
  );
}
