"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError } from "@/features/entry/client";
import { formatWindow } from "@/features/entry/components/availability-picker";
import {
  socialApi,
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
    <SocialShell title="What do you want to do?">
      {!loaded && <p role="status">Loading your profile…</p>}
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
    <SocialShell title="Your seeking post">
      <SocialError message={action.error} focusRef={action.errorRef} />
      {!post && !action.error && <p role="status">Loading your activity…</p>}
      {post && (
        <article className="social-card">
          <h2>{post.activityLabel}</h2>
          <p className="social-plain">{post.rawText}</p>
          <p>
            Status: {post.status} · Privacy: {post.privacyMode}
          </p>
          <dl>
            <dt>Interaction</dt>
            <dd>
              {post.interactionMode === "in_person"
                ? "In person"
                : post.interactionMode === "online"
                  ? "Online"
                  : "Either"}
            </dd>
            <dt>Format</dt>
            <dd>{post.format === "one_to_one" ? "One to one" : post.format}</dd>
            <dt>City / coarse area</dt>
            <dd>
              {[post.city, post.area].filter(Boolean).join(" / ") || "Online"}
            </dd>
            <dt>Skill</dt>
            <dd>{post.skill}</dd>
            <dt>Languages</dt>
            <dd>{post.languages.join(", ")}</dd>
            <dt>Tags</dt>
            <dd>{post.tags.join(", ") || "None"}</dd>
            <dt>Desired age bands</dt>
            <dd>{post.desiredAgeBands.join(", ") || "No restriction"}</dd>
            <dt>Group size</dt>
            <dd>{post.groupSize ?? "Flexible"}</dd>
            <dt>Expires</dt>
            <dd>{new Date(post.expiresAt).toLocaleString()}</dd>
          </dl>
          <h3>Your private availability</h3>
          <ul>
            {post.availability.map((w) => (
              <li key={w.startAt}>{formatWindow(w)}</li>
            ))}
          </ul>
          <div className="social-actions">
            {post.status === "active" && (
              <>
                <Link className="button button-primary" href="/discover">
                  Find people
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
                  Close post
                </button>
              </>
            )}
            <Link className="button button-secondary" href="/seek/new">
              Create another activity
            </Link>
          </div>
        </article>
      )}
    </SocialShell>
  );
}
