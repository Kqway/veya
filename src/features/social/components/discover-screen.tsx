"use client";
import Link from "next/link";
import { useSocialRefresh } from "@/features/realtime/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/features/entry/client";
import {
  socialApi,
  postStatusLabels,
  useSocialAction,
  type Card,
  type OwnPost,
  type Profile,
} from "../client";
import { Person, SocialError, SocialShell, SocialLiveStatus } from "./common";
import { ProfilePanel } from "./profile-panel";
const reasonCopy: Record<string, string> = {
  SAME_ACTIVITY: "Вы хотите заниматься одним и тем же",
  TIME_OVERLAP: "Ваше свободное время совпадает",
  SAME_AREA: "Вам подходит один район",
  SKILL_COMPATIBLE: "Ваши уровни опыта совместимы",
  SHARED_LANGUAGE: "У вас есть общий язык",
  SHARED_INTEREST: "У вас общие интересы",
  FORMAT_COMPATIBLE: "Вам подходит один формат встречи",
};
export function DiscoverScreen() {
  const [profile, setProfile] = useState<Profile | null>(null),
    [loaded, setLoaded] = useState(false),
    [postsLoaded, setPostsLoaded] = useState(false),
    [restricted, setRestricted] = useState(false),
    [posts, setPosts] = useState<OwnPost[]>([]),
    [source, setSource] = useState(""),
    [cards, setCards] = useState<Card[] | null>(null),
    [notice, setNotice] = useState("");
  const action = useSocialAction();
  const { run } = action;
  // Live reads must not disable or move controls during a user click.
  const { run: runBackground } = useSocialAction();
  const loadGeneration = useRef(0);
  const runCurrent = useCallback((work: (current: () => boolean) => Promise<void>) =>
    run(async (alive) => {
      const generation = ++loadGeneration.current;
      const current = () => alive() && generation === loadGeneration.current;
      try { await work(current); }
      catch (error) { if (current()) throw error; }
    }), [run]);
  const loadActivities = useCallback(() => run(async (alive) => {
      const generation = ++loadGeneration.current;
      const current = () => alive() && generation === loadGeneration.current;
      setPostsLoaded(false);
      try {
        const data = await socialApi<{ profile: Profile | null }>("/profile");
        if (!current()) return;
        setProfile(data.profile);
        if (data.profile) {
          const own = await socialApi<{ posts: OwnPost[] }>("/seeking");
          if (current()) {
            setPosts(own.posts);
            setPostsLoaded(true);
            setSource(
              own.posts.find((p) => p.status === "active")?.publicKey ?? "",
            );
          }
        }
      } catch (e) {
        if (!current()) return;
        if (e instanceof ApiError && e.status === 403) {
          if (current()) setRestricted(true);
          return;
        }
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      } finally {
        if (current()) setLoaded(true);
      }
    }), [run]);
  useEffect(() => { void loadActivities(); }, [loadActivities]);
  const reloadCandidates = useCallback(() => runBackground(async (alive) => {
    if (!source) return;
    const generation = loadGeneration.current;
    const data = await socialApi<{ cards: Card[] }>(`/discover?source=${encodeURIComponent(source)}`);
    if (alive() && generation === loadGeneration.current) setCards(data.cards);
  }), [source, runBackground]);
  const live = useSocialRefresh(["discovery", "connections"], reloadCandidates, { enabled: !!profile && !!source && cards !== null && !action.busy });
  function onProfile(value: Profile | null) {
    ++loadGeneration.current;
    setRestricted(false);
    setProfile(value);
    if (!value) {
      setPosts([]);
      setPostsLoaded(false);
      setSource("");
      setCards(null);
      setNotice("");
      return;
    }
    if (!profile)
      void runCurrent(async (alive) => {
        setPostsLoaded(false);
        const own = await socialApi<{ posts: OwnPost[] }>("/seeking");
        if (alive()) {
          setPosts(own.posts);
          setPostsLoaded(true);
          setSource(
            own.posts.find((p) => p.status === "active")?.publicKey ?? "",
          );
        }
      });
  }
  return (
    <SocialShell title="Найдите людей для совместных занятий">
      {!loaded && <p role="status">Загружаем ваш профиль…</p>}
      <SocialError message={action.error} focusRef={action.errorRef} />
      {loaded && (action.error || profile) && !postsLoaded && !restricted && (
        <button className="button button-secondary" disabled={action.busy}
          onClick={() => { void loadActivities(); }}>
          Загрузить занятия снова
        </button>
      )}
      {profile && <SocialLiveStatus {...live} />}
      {loaded && (
        <>
          <ProfilePanel profile={profile} onProfile={onProfile} restricted={restricted} />
          {profile && (
            <>
              <section className="social-card">
                <h2>Начните с занятия</h2>
                <p>
                  Поиск использует одну из ваших активных заявок на занятие. Одновременно можно иметь до трёх активных заявок. Кнопка «Хочу присоединиться» отправляет запрос. Личный чат откроется только после его принятия.
                </p>
                <Link className="button button-secondary" href="/seek/new">
                  Создать заявку на занятие
                </Link>
                {!postsLoaded ? (
                  <p role="status">{restricted ? "Ваши занятия недоступны в этой сессии." : action.busy ? "Загружаем ваши занятия…" : "Не удалось загрузить ваши занятия. Нажмите «Загрузить занятия снова», чтобы повторить попытку."}</p>
                ) : posts.some((p) => p.status === "active") ? (
                  <>
                    <label className="field">
                      Ваша активная заявка
                      <select
                        value={source}
                        onChange={(e) => {
                          ++loadGeneration.current;
                          setSource(e.target.value);
                          setCards(null);
                          setNotice("");
                        }}
                      >
                        {posts
                          .filter((p) => p.status === "active")
                          .map((p) => (
                            <option value={p.publicKey} key={p.publicKey}>
                              {p.activityLabel}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="button button-primary"
                      disabled={action.busy || !source}
                      onClick={() => {
                        void runCurrent(async (alive) => {
                          const data = await socialApi<{ cards: Card[] }>(
                            `/discover?source=${encodeURIComponent(source)}`,
                          );
                          if (alive()) {
                            setCards(data.cards);
                            setNotice("");
                          }
                        });
                      }}
                    >
                      Найти людей
                    </button>
                  </>
                ) : (
                  <p>
                    Активных заявок на занятие пока нет. Создайте заявку и укажите свободное время, чтобы найти подходящих людей.
                  </p>
                )}
                <ul className="social-post-list">
                  {posts.map((post) => (
                    <li key={post.publicKey}>
                      <Link
                        href={`/seek/${encodeURIComponent(post.publicKey)}`}
                      >
                        {post.activityLabel}
                      </Link>
                      <span>{postStatusLabels[post.status]}</span>
                      {post.status === "active" && (
                        <button
                          className="social-text-button"
                          disabled={action.busy}
                          onClick={() => {
                            void runCurrent(async (alive) => {
                              await socialApi(
                                `/seeking/${encodeURIComponent(post.publicKey)}`,
                                "DELETE",
                              );
                              if (alive()) {
                                const next = posts.map((p) =>
                                  p.publicKey === post.publicKey
                                    ? { ...p, status: "closed" as const }
                                    : p,
                                );
                                setPosts(next);
                                if (source === post.publicKey) {
                                  setSource(
                                    next.find((p) => p.status === "active")
                                      ?.publicKey ?? "",
                                  );
                                  setCards(null);
                                }
                              }
                            });
                          }}
                        >
                          Закрыть заявку
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-label="Подходящие люди">
                {action.busy && <p role="status">Выполняем…</p>}
                {cards?.length === 0 && (
                  <p className="social-card">
                    Пока не удалось найти подходящих людей для этого занятия. Попробуйте другое занятие или свободное время. Для подбора нужны общее занятие, совместимый формат, общий язык и совпадающее свободное время в будущем. Ваша заявка сохранена до истечения срока действия. Здесь могут появиться новые подходящие заявки — загляните позже. Если включены уведомления о подходящих людях, раздел <Link href="/notifications">уведомлений</Link> сообщит о новом подходящем занятии. Intavro никогда не отправляет запрос «Хочу присоединиться» за вас.
                  </p>
                )}
                {cards?.map((card) => (
                  <article className="social-card" key={card.handle}>
                    <Person identity={card.identity} />
                    <h2>{card.activityLabel}</h2>
                    <p>
                      {card.interactionMode === "in_person"
                        ? "Вживую"
                        : card.interactionMode === "online"
                          ? "Онлайн"
                          : "Вживую или онлайн"}{" "}
                      ·{" "}
                      {card.format === "one_to_one"
                        ? "Вдвоём"
                        : card.format === "group"
                          ? "В группе"
                          : "Любой состав группы"}
                    </p>
                    <ul>
                      {card.reasons
                        .filter((r) => reasonCopy[r])
                        .map((r) => (
                          <li key={r}>{reasonCopy[r]}</li>
                        ))}
                    </ul>
                    <p>
                      {({
                        "Compatible today": "Подходит сегодня",
                        "Compatible tomorrow": "Подходит завтра",
                        "Compatible this week": "Подходит на этой неделе",
                        "Compatible soon": "Подходит в ближайшее время",
                      } as Record<string, string>)[card.timeHint] ?? "Совпадает свободное время"}
                    </p>
                    <div className="social-actions">
                      <button
                        className="button button-primary"
                        disabled={action.busy}
                        onClick={() => {
                          void runCurrent(async (alive) => {
                            await socialApi("/connections", "POST", {
                              handle: card.handle,
                            });
                            if (alive()) {
                              setCards(
                                (values) =>
                                  values?.filter(
                                    (c) => c.handle !== card.handle,
                                  ) ?? [],
                              );
                              setNotice(
                                "Запрос отправлен. Следить за ним можно в разделе «Запросы».",
                              );
                            }
                          });
                        }}
                      >
                        Хочу присоединиться
                      </button>
                      <button
                        className="button button-secondary"
                        disabled={action.busy}
                        onClick={() => {
                          void runCurrent(async (alive) => {
                            await socialApi(
                              `/discover/${encodeURIComponent(card.handle)}/pass`,
                              "POST",
                              {},
                            );
                            if (alive())
                              setCards(
                                (values) =>
                                  values?.filter(
                                    (c) => c.handle !== card.handle,
                                  ) ?? [],
                              );
                          });
                        }}
                      >
                        Пропустить
                      </button>
                    </div>
                  </article>
                ))}
                {notice && (
                  <p role="status">
                    {notice} <Link href="/connections">Посмотреть запросы</Link>
                  </p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </SocialShell>
  );
}
