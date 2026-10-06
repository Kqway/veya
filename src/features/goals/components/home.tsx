"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ensureGuest, socialApi, type Profile } from "@/features/social/client";
import type { GoalDTO } from "../schema";
import { agentApi, useGoalAction, useGoalResource } from "./client";
import {
  Arrow,
  DemoNotice,
  ErrorState,
  GoalCard,
  Skeleton,
} from "./primitives";
import { GoalOnboarding } from "./onboarding";

const examples = [
  "Заработать 30 000 ₽",
  "Найти хорошую стажировку",
  "Продать мой ноутбук",
  "Организовать поездку",
];
export function GoalHome() {
  const [text, setText] = useState(""),
    [onboarding, setOnboarding] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null),
    router = useRouter(),
    action = useGoalAction();
  const resource = useGoalResource<{ goals: GoalDTO[] }>("/goals", {
    allowUnbound: true,
  });
  async function start(current: () => boolean = () => true) {
    if (!current()) return;
    const result = await agentApi<{ goal: GoalDTO }>("/goals", "POST", {
      text: text.trim(),
      environment: "demo",
    });
    if (current()) router.push(`/goals/${result.goal.publicKey}`);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    void action.run(async (current) => {
      await ensureGuest();
      if (!current()) return;
      const { profile } = await socialApi<{ profile: Profile | null }>(
        "/profile",
      );
      if (!current()) return;
      if (!profile) {
        setOnboarding(true);
        return;
      }
      await start(current);
    });
  }
  return (
    <section className="goal-home">
      <div className="goal-composer-heading">
        <p className="goal-eyebrow">
          <span className="goal-orbit" aria-hidden="true" />
          От намерения к результату
        </p>
        <h1>
          Что должно
          <br className="goal-mobile-break" /> произойти?
        </h1>
        <p className="goal-home-subtitle">
          Вы задаёте цель. Veya берёт её в работу.
        </p>
      </div>
      <form className="goal-composer" onSubmit={submit}>
        <label className="goal-visually-hidden" htmlFor="goal-intent">
          Что должно произойти?
        </label>
        <textarea
          id="goal-intent"
          ref={input}
          placeholder="Заработать 30 000 ₽"
          maxLength={500}
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={action.busy}
          rows={3}
        />
        <div className="goal-composer-bottom">
          <span>Одна фраза — начало.</span>
          <button
            className="goal-button"
            type="submit"
            disabled={!text.trim() || action.busy}
          >
            {action.busy ? "Начинаю…" : "Начать"}
            <Arrow />
          </button>
        </div>
      </form>
      <div className="goal-examples" aria-label="Примеры целей">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setText(example);
              input.current?.focus();
            }}
          >
            {example}
            <Arrow diagonal />
          </button>
        ))}
      </div>
      <DemoNotice />
      <ErrorState
        message={action.error ?? resource.error}
        {...(resource.error ? { retry: resource.reload } : {})}
      />
      {onboarding && <GoalOnboarding onReady={start} />}
      <section className="goal-home-processes" aria-label="Ваши цели">
        {resource.loading ? (
          <Skeleton label="Загружаю цели…" />
        ) : resource.data?.goals.length ? (
          <>
            <div className="goal-section-heading">
              <h2>В работе и в результате</h2>
              <span>{resource.data.goals.length}</span>
            </div>
            <div className="goal-list">
              {resource.data.goals.map((goal) => (
                <GoalCard key={goal.publicKey} goal={goal} />
              ))}
            </div>
          </>
        ) : null}
      </section>
    </section>
  );
}
