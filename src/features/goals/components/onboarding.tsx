"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ensureGuest, socialApi, type Profile } from "@/features/social/client";
import { useRecoveryKey } from "@/features/social/components/recovery-key-provider";
import { Arrow, ErrorState } from "./primitives";
import { useGoalAction } from "./client";

export function GoalOnboarding({
  onReady,
}: {
  onReady: (current: () => boolean) => Promise<void>;
}) {
  const [alias, setAlias] = useState(""),
    [adult, setAdult] = useState(false),
    [privacy, setPrivacy] = useState(false);
  const action = useGoalAction(),
    recovery = useRecoveryKey();
  function create(event: FormEvent) {
    event.preventDefault();
    void action.run(async (current) => {
      await ensureGuest();
      if (!current()) return;
      const existing = await socialApi<{ profile: Profile | null }>("/profile");
      if (!current()) return;
      if (!existing.profile) {
        const result = await socialApi<{
          profile: Profile;
          recoveryKey?: string;
        }>("/profile", "POST", {
          alias: alias.trim(),
          privacyMode: "PRIVATE",
          adultConfirmed: adult,
          languages: ["ru"],
          ageBand: null,
        });
        if (result.recoveryKey) recovery.showKey(result.recoveryKey);
        if (!current()) return;
        action.profileCommitted();
      }
      if (current()) await onReady(current);
    });
  }
  return (
    <section className="goal-onboarding" aria-label="Ваш профиль">
      <p className="goal-eyebrow">Один раз, перед началом</p>
      <h2>Как к вам обращаться?</h2>
      <p className="goal-muted">
        Цель останется связана с вашим приватным профилем.
      </p>
      <form onSubmit={create}>
        <fieldset disabled={action.busy}>
          <label className="goal-field">
            Псевдоним
            <input
              required
              minLength={1}
              maxLength={60}
              value={alias}
              autoComplete="off"
              onChange={(event) => setAlias(event.target.value)}
            />
          </label>
          <label className="goal-check">
            <input
              type="checkbox"
              required
              checked={adult}
              onChange={(event) => setAdult(event.target.checked)}
            />
            Мне исполнилось 18 лет
          </label>
          <label className="goal-check">
            <input
              type="checkbox"
              required
              checked={privacy}
              onChange={(event) => setPrivacy(event.target.checked)}
            />
            Я сам решаю, что раскрыть о себе
          </label>
          <button
            className="goal-button"
            disabled={!alias.trim() || !adult || !privacy || action.busy}
          >
            Продолжить <Arrow />
          </button>
        </fieldset>
      </form>
      <ErrorState message={action.error} />
      <Link className="goal-text-button" href="/settings">
        Восстановить профиль по ключу <Arrow />
      </Link>
    </section>
  );
}
