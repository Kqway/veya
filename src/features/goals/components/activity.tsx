"use client";
import type { GoalEventDTO } from "../schema";
import { useGoalResource } from "./client";
import { ErrorState, GoalPageShell, Skeleton, Timeline } from "./primitives";

export function GoalActivity() {
  const resource = useGoalResource<{ events: GoalEventDTO[] }>("/activity", {
    allowUnbound: true,
  });
  return (
    <GoalPageShell
      eyebrow="Активность"
      title="Всё, что произошло."
      description="Сохранённые события ваших целей."
    >
      <ErrorState message={resource.error} retry={resource.reload} />
      {resource.loading ? (
        <Skeleton label="Загружаю события…" />
      ) : resource.data?.events.length ? (
        <Timeline events={resource.data.events} />
      ) : (
        <div className="goal-empty">
          <span className="goal-empty-orbit" aria-hidden="true" />
          <h2>Пока тихо.</h2>
          <p>Когда Veya начнёт работу, здесь появятся первые события.</p>
        </div>
      )}
    </GoalPageShell>
  );
}
