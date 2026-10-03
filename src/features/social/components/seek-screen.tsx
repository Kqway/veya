"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/features/entry/client";
import { formatWindow } from "@/features/entry/components/availability-picker";
import {
  socialApi,
  privacyLabels,
  formatLabels,
  skillLabels,
  postStatusLabels,
  useSocialAction,
  type OwnPost,
  type Profile,
} from "../client";
import { SocialError, SocialShell } from "./common";
import { ProfilePanel } from "./profile-panel";
import { SeekingForm } from "./seeking-form";
export function NewSeekScreen() {
  const [profile, setProfile] = useState<Profile | null>(null),
    [restricted, setRestricted] = useState(false),
    [loaded, setLoaded] = useState(false);
  const action = useSocialAction();
  const { run } = action;
  useEffect(() => {
    void run(async (alive) => {
      try {
        const data = await socialApi<{ profile: Profile | null }>("/profile");
        if (alive()) setProfile(data.profile);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          if (alive()) setRestricted(true);
          return;
        }
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      } finally {
        if (alive()) setLoaded(true);
      }
    });
  }, [run]);
  return (
    <SocialShell title="Чем хотите заняться?">
      {!loaded && <p role="status">Загружаем ваш профиль…</p>}
      <SocialError message={action.error} focusRef={action.errorRef} />
      {loaded && (
        <>
          <ProfilePanel profile={profile} restricted={restricted} onProfile={(value) => { setProfile(value); setRestricted(false); }} />
          {profile && <SeekingForm profile={profile} />}
        </>
      )}
    </SocialShell>
  );
}
export function OwnSeekScreen({ postKey }: { postKey: string }) {
  const [post, setPost] = useState<OwnPost | null>(null);
  const action = useSocialAction();
  const { run } = action;
  useEffect(() => {
    void run(async (alive) => {
      const data = await socialApi<OwnPost>(
        `/seeking/${encodeURIComponent(postKey)}`,
      );
      if (alive()) setPost(data);
    });
  }, [postKey, run]);
  return (
    <SocialShell title="Ваша заявка на занятие">
      <SocialError message={action.error} focusRef={action.errorRef} />
      {!post && !action.error && <p role="status">Загружаем ваше занятие…</p>}
      {post && (
        <article className="social-card">
          <h2>{post.activityLabel}</h2>
          <p className="social-plain">{post.rawText}</p>
          <p>
            Статус: {postStatusLabels[post.status]} · Приватность: {privacyLabels[post.privacyMode]}
          </p>
          <dl>
            <dt>Способ встречи</dt>
            <dd>
              {post.interactionMode === "in_person"
                ? "Вживую"
                : post.interactionMode === "online"
                  ? "Онлайн"
                  : "Любой вариант"}
            </dd>
            <dt>Формат</dt>
            <dd>{formatLabels[post.format]}</dd>
            <dt>Город / район</dt>
            <dd>
              {[post.city, post.area].filter(Boolean).join(" / ") || "Онлайн"}
            </dd>
            <dt>Уровень опыта</dt>
            <dd>{skillLabels[post.skill]}</dd>
            <dt>Языки</dt>
            <dd>{post.languages.join(", ")}</dd>
            <dt>Теги</dt>
            <dd>{post.tags.join(", ") || "Нет"}</dd>
            <dt>Предпочтительные возрастные группы</dt>
            <dd>{post.desiredAgeBands.join(", ") || "Без ограничений"}</dd>
            <dt>Размер группы</dt>
            <dd>{post.groupSize ?? "Любой"}</dd>
            <dt>Срок действия</dt>
            <dd>{new Date(post.expiresAt).toLocaleString("ru-RU")}</dd>
          </dl>
          <h3>Ваше свободное время — только для вас</h3>
          <ul>
            {post.availability.map((w) => (
              <li key={w.startAt}>{formatWindow(w)}</li>
            ))}
          </ul>
          <div className="social-actions">
            {post.status === "active" && (
              <>
                <Link className="button button-primary" href="/discover">
                  Найти людей
                </Link>
                <button
                  className="button button-secondary"
                  disabled={action.busy}
                  onClick={() => {
                    void run(async (alive) => {
                      await socialApi(
                        `/seeking/${encodeURIComponent(postKey)}`,
                        "DELETE",
                      );
                      if (alive()) setPost({ ...post, status: "closed" });
                    });
                  }}
                >
                  Закрыть заявку
                </button>
              </>
            )}
            <Link className="button button-secondary" href="/seek/new">
              Создать ещё одно занятие
            </Link>
          </div>
        </article>
      )}
    </SocialShell>
  );
}
