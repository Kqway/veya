"use client";
import Link from "next/link";
import { useSocialRefresh } from "@/features/realtime/client";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/features/entry/client";
import {
  socialApi,
  useSocialAction,
  type Card,
  type OwnPost,
  type Profile,
} from "../client";
import { Person, SocialError, SocialShell, SocialLiveStatus } from "./common";
import { ProfilePanel } from "./profile-panel";
const reasonCopy: Record<string, string> = {
  SAME_ACTIVITY: "You want to do the same activity",
  TIME_OVERLAP: "Your availability is compatible",
  SAME_AREA: "A similar area preference",
  SKILL_COMPATIBLE: "Compatible experience levels",
  SHARED_LANGUAGE: "A shared language",
  SHARED_INTEREST: "Shared interests",
  FORMAT_COMPATIBLE: "A compatible way to meet",
};
export function DiscoverScreen() {
  const [profile, setProfile] = useState<Profile | null>(null),
    [loaded, setLoaded] = useState(false),
    [restricted, setRestricted] = useState(false),
    [posts, setPosts] = useState<OwnPost[]>([]),
    [source, setSource] = useState(""),
    [cards, setCards] = useState<Card[] | null>(null),
    [notice, setNotice] = useState("");
  const action = useSocialAction();
  const { run } = action;
  useEffect(() => {
    void run(async (alive) => {
      try {
        const data = await socialApi<{ profile: Profile | null }>("/profile");
        if (!alive()) return;
        setProfile(data.profile);
        if (data.profile) {
          const own = await socialApi<{ posts: OwnPost[] }>("/seeking");
          if (alive()) {
            setPosts(own.posts);
            setSource(
              own.posts.find((p) => p.status === "active")?.publicKey ?? "",
            );
          }
        }
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
  const reloadCandidates = useCallback(() => run(async (alive) => {
    if (!source) return;
    const data = await socialApi<{ cards: Card[] }>(`/discover?source=${encodeURIComponent(source)}`);
    if (alive()) setCards(data.cards);
  }), [source, run]);
  const live = useSocialRefresh(["discovery", "connections"], reloadCandidates, { enabled: !!profile && !!source && cards !== null && !action.busy });
  function onProfile(value: Profile | null) {
    setRestricted(false);
    setProfile(value);
    if (!value) {
      setPosts([]);
      setSource("");
      setCards(null);
      setNotice("");
      return;
    }
    if (!profile)
      void run(async (alive) => {
        const own = await socialApi<{ posts: OwnPost[] }>("/seeking");
        if (alive()) {
          setPosts(own.posts);
          setSource(
            own.posts.find((p) => p.status === "active")?.publicKey ?? "",
          );
        }
      });
  }
  return (
    <SocialShell title="Find compatible people">
      {!loaded && <p role="status">Loading your profile…</p>}
      <SocialError message={action.error} focusRef={action.errorRef} />
      {profile && <SocialLiveStatus {...live} />}
      {loaded && (
        <>
          <ProfilePanel profile={profile} onProfile={onProfile} restricted={restricted} />
          {profile && (
            <>
              <section className="social-card">
                <h2>Start with your activity</h2>
                <p>
                  Discovery uses one of your active seeking posts. You can have
                  up to three active posts. Interested sends a request; a private
                  conversation opens only after the recipient accepts.
                </p>
                <Link className="button button-secondary" href="/seek/new">
                  Create a seeking post
                </Link>
                {posts.some((p) => p.status === "active") ? (
                  <>
                    <label className="field">
                      Your active activity
                      <select
                        value={source}
                        onChange={(e) => {
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
                        void run(async (alive) => {
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
                      Find people
                    </button>
                  </>
                ) : (
                  <p>
                    No active seeking posts yet. Create one with your
                    availability to discover compatible people.
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
                      <span>{post.status}</span>
                      {post.status === "active" && (
                        <button
                          className="social-text-button"
                          disabled={action.busy}
                          onClick={() => {
                            void run(async (alive) => {
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
                          Close post
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-label="Compatible people">
                {action.busy && <p role="status">Working…</p>}
                {cards?.length === 0 && (
                  <p className="social-card">
                    No compatible people found for this activity yet. Try
                    another activity or availability. Matching needs the same activity,
                    compatible format, a shared language and overlapping future times.
                    Your activity is saved until it expires. New compatible posts can
                    appear here; check again later. If candidate updates are enabled,
                    your <Link href="/notifications">notification inbox</Link> can let
                    you know about a new compatible activity. Veya never sends Interested for you.
                  </p>
                )}
                {cards?.map((card) => (
                  <article className="social-card" key={card.handle}>
                    <Person identity={card.identity} />
                    <h2>{card.activityLabel}</h2>
                    <p>
                      {card.interactionMode === "in_person"
                        ? "In person"
                        : card.interactionMode === "online"
                          ? "Online"
                          : "In person or online"}{" "}
                      ·{" "}
                      {card.format === "one_to_one"
                        ? "One to one"
                        : card.format === "group"
                          ? "Group"
                          : "Flexible group format"}
                    </p>
                    <ul>
                      {card.reasons
                        .filter((r) => reasonCopy[r])
                        .map((r) => (
                          <li key={r}>{reasonCopy[r]}</li>
                        ))}
                    </ul>
                    <p>
                      {[
                        "Compatible today",
                        "Compatible tomorrow",
                        "Compatible this week",
                        "Compatible soon",
                      ].includes(card.timeHint)
                        ? card.timeHint
                        : "Compatible availability"}
                    </p>
                    <div className="social-actions">
                      <button
                        className="button button-primary"
                        disabled={action.busy}
                        onClick={() => {
                          void run(async (alive) => {
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
                                "Interest sent. You can follow the request in Connections.",
                              );
                            }
                          });
                        }}
                      >
                        Interested
                      </button>
                      <button
                        className="button button-secondary"
                        disabled={action.busy}
                        onClick={() => {
                          void run(async (alive) => {
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
                        Pass
                      </button>
                    </div>
                  </article>
                ))}
                {notice && (
                  <p role="status">
                    {notice} <Link href="/connections">View connections</Link>
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
