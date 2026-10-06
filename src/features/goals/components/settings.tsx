"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/features/entry/client";
import { socialApi, type Profile } from "@/features/social/client";
import { ProfilePanel } from "@/features/social/components/profile-panel";
import { PushControls } from "@/features/notifications/components";
import { Arrow, ErrorState, GoalPageShell, Skeleton } from "./primitives";
import { goalError } from "./client";

export function GoalSettings() {
  const [profile, setProfile] = useState<Profile | null>(null),
    [loaded, setLoaded] = useState(false);
  const [restricted, setRestricted] = useState(false),
    [error, setError] = useState<string | null>(null);
  const scope = useRef({ active: false, generation: 0 });
  useEffect(() => {
    const own = scope.current;
    own.active = true;
    const refresh = async () => {
      const generation = ++own.generation,
        current = () => own.active && generation === own.generation;
      // Hide and unmount old forms until this browser binding is authoritative.
      setProfile(null);
      setLoaded(false);
      setRestricted(false);
      setError(null);
      try {
        const result = await socialApi<{ profile: Profile | null }>("/profile");
        if (current()) setProfile(result.profile);
      } catch (cause) {
        if (!current()) return;
        if (cause instanceof ApiError && cause.status === 403)
          setRestricted(true);
        else if (!(
          cause instanceof ApiError && [401, 404].includes(cause.status)
        ))
          setError(goalError(cause));
      } finally {
        if (current()) setLoaded(true);
      }
    };
    const changed = () => {
      void refresh();
    };
    void Promise.resolve().then(refresh);
    window.addEventListener("focus", changed);
    window.addEventListener("veya:social-profile-changed", changed);
    return () => {
      own.active = false;
      ++own.generation;
      window.removeEventListener("focus", changed);
      window.removeEventListener("veya:social-profile-changed", changed);
    };
  }, []);
  return (
    <GoalPageShell
      eyebrow="Ваше пространство"
      title="Всё под вашим контролем."
      description="Veya действует в пределах ваших разрешений."
    >
      <ErrorState message={error} />
      {!loaded ? (
        <Skeleton label="Загружаю профиль…" />
      ) : (
        <>
          <section className="goal-identity">
            <div className="goal-identity-avatar" aria-hidden="true">
              {profile?.alias.slice(0, 1).toUpperCase() ?? "v"}
            </div>
            <div>
              <p className="goal-eyebrow">Identity</p>
              <h2>
                {profile?.alias ??
                  (restricted ? "Профиль недоступен" : "Ваш профиль")}
              </h2>
              <p className="goal-muted">
                {profile
                  ? "Приватные цели. Сохранённые разрешения. Один ключ восстановления."
                  : "Для начала достаточно псевдонима. Email и пароль не нужны."}
              </p>
            </div>
          </section>
          <div className="goal-settings-links">
            <Link href="/connections">
              <span>
                <strong>Способности и подключения</strong>
                <small>Что Veya может использовать</small>
              </span>
              <Arrow />
            </Link>
            <Link href="/autonomy">
              <span>
                <strong>Автономия</strong>
                <small>Что можно делать без вашего решения</small>
              </span>
              <Arrow />
            </Link>
            <Link href="/notifications">
              <span>
                <strong>Уведомления</strong>
                <small>Результат, решение и важные изменения</small>
              </span>
              <Arrow />
            </Link>
          </div>
          <details className="goal-account-controls" open={!profile}>
            <summary>
              {profile
                ? "Личность, приватность и восстановление"
                : "Создать или восстановить профиль"}
              <span aria-hidden="true">+</span>
            </summary>
            <ProfilePanel
              key={profile?.avatarSeed ?? "unbound"}
              profile={profile}
              onProfile={setProfile}
              restricted={restricted}
            />
          </details>
          {profile && (
            <details className="goal-account-controls">
              <summary>
                Уведомления браузера<span aria-hidden="true">+</span>
              </summary>
              <PushControls />
            </details>
          )}
          <div className="goal-settings-secondary">
            <Link href="/network">
              Intent Network <Arrow diagonal />
            </Link>
            <Link href="/plan">
              Совместные планы <Arrow diagonal />
            </Link>
            <Link href="/network/profile">
              Оформление пространства <Arrow diagonal />
            </Link>
          </div>
        </>
      )}
    </GoalPageShell>
  );
}
