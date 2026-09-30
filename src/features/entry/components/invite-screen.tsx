"use client";
import { RepeatPlan } from "./repeat-plan";
import { LoadingPlan } from "./loading-plan";
import { IntentHints } from "./intent-hints";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { IntentView } from "@/features/backend/types";
import { useAnalytics } from "@/lib/analytics/browser";
import { ApiError, requestApi } from "../client";
import { formatMoney } from "../form-values";
import { formatWindow } from "./availability-picker";
import { ParticipantForm } from "./participant-form";
import { SharePanel } from "./share-panel";
export function InviteScreen({ slug }: { slug: string }) {
  const [view, setView] = useState<IntentView | null>(null),
    [error, setError] = useState<ApiError | null>(null),
    [editing, setEditing] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    track = useAnalytics(),
    tracked = useRef(false);
  useEffect(() => {
    let active = true;
    requestApi<IntentView>(`/api/intents/${encodeURIComponent(slug)}`)
      .then((result) => {
        if (active) {
          setView(result);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(e as ApiError);
      });
    return () => {
      active = false;
    };
  }, [slug]);
  useEffect(() => {
    if (view) {
      heading.current?.focus();
      if (!tracked.current) {
        tracked.current = true;
        track("invite_opened");
      }
    }
  }, [view, track]);
  async function retry() {
    setError(null);
    try {
      setView(
        await requestApi<IntentView>(
          `/api/intents/${encodeURIComponent(slug)}`,
        ),
      );
    } catch (e) {
      setError(e as ApiError);
    }
  }
  if (error && !view)
    return (
      <section className="message-page">
        <p className="eyebrow">A little detour</p>
        <h1>
          {error.code === "NOT_FOUND"
            ? "This invite couldn't be found."
            : "Your plan is taking a moment."}
        </h1>
        <p>
          {error.code === "NOT_FOUND"
            ? "Check the link with your friend, or start something new together."
            : "We couldn't load the plan. Please try again."}
        </p>
        <div className="form-actions">
          {error.code !== "NOT_FOUND" && (
            <button
              className="button button-primary"
              onClick={() => void retry()}
            >
              Try again
            </button>
          )}
          <Link className="button button-secondary" href="/">
            Start a new plan
          </Link>
        </div>
      </section>
    );
  if (!view) return <LoadingPlan />;
  const { intent, ownParticipant } = view,
    closed = intent.status === "expired" || intent.status === "decided";
  return (
    <div className="invite-page">
      <section className="invite-heading">
        <p className="eyebrow">A little idea. Your people.</p>
        <h1 ref={heading} tabIndex={-1}>
          {view.isCreator
            ? "Your plan is ready to invite people."
            : `${intent.creatorName} wants to make a plan.`}
        </h1>
        <p className="invite-idea">{intent.rawText}</p>
        {(intent.structuredIntent.activities.length > 0 ||
          intent.structuredIntent.location) && (
          <div className="intent-tags">
            {intent.structuredIntent.activities.map((a) => (
              <span key={a}>{a}</span>
            ))}
            {intent.structuredIntent.location && (
              <span>{intent.structuredIntent.location}</span>
            )}
          </div>
        )}
        <IntentHints
          dateHint={intent.structuredIntent.dateHint}
          budgetHint={intent.structuredIntent.budgetHint}
        />
        <p className="quiet-copy">
          <strong>{intent.participantCount}</strong>{" "}
          {intent.participantCount === 1 ? "person has" : "people have"} added
          availability · Replies until{" "}
          {new Date(intent.expiresAt).toLocaleDateString("en", {
            month: "short",
            day: "numeric",
          })}
        </p>
      </section>
      <div className="results-entry">
        <Link
          className="button button-primary"
          href={`/i/${intent.publicSlug}/results`}
        >
          {intent.status === "decided"
            ? "See the confirmed plan"
            : "Find a time together"}
        </Link>
        <p className="quiet-copy">
          Shared times, useful compromises, and a say for everyone.
        </p>
      </div>
      {closed ? (
        <section className="entry-card closed-plan">
          <h2>
            {intent.status === "decided"
              ? "This plan is closed to changes."
              : "This invite has expired."}
          </h2>
          <p>
            Keep the good idea going. Start a fresh plan and bring your people.
          </p>
          <Link className="button button-primary" href="/">
            Start a new plan
          </Link>
        </section>
      ) : (
        <>
          {view.isCreator && (
            <SharePanel
              slug={intent.publicSlug}
              creatorName={intent.creatorName}
            />
          )}
          {editing ? (
            <ParticipantForm
              view={view}
              onSaved={(result) => {
                setView(result);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : ownParticipant ? (
            <section className="entry-card own-details">
              <p className="eyebrow">You&apos;re part of the plan</p>
              <h2>You&apos;re in, {ownParticipant.displayName}.</h2>
              <p className="quiet-copy">
                Your availability is saved. Come back with the same browser to
                edit it.
              </p>
              <ul className="saved-times">
                {ownParticipant.availability.map((w) => (
                  <li key={`${w.startAt}-${w.endAt}`}>{formatWindow(w)}</li>
                ))}
              </ul>
              {ownParticipant.budgetMax !== null && (
                <p>
                  Maximum budget:{" "}
                  {formatMoney(
                    ownParticipant.budgetMax,
                    ownParticipant.currency,
                  )}{" "}
                  {ownParticipant.currency}
                </p>
              )}
              {ownParticipant.preferences.length > 0 && (
                <p className="quiet-copy">
                  {ownParticipant.preferences.map((p) => p.value).join(" · ")}
                </p>
              )}
              {ownParticipant.notes && (
                <p className="participant-note">{ownParticipant.notes}</p>
              )}
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setEditing(true)}
              >
                Edit your details
              </button>
            </section>
          ) : (
            <section className="entry-card join-card">
              <h2>
                {view.isCreator
                  ? "Make the first move."
                  : "A good time starts with you."}
              </h2>
              <p className="quiet-copy">
                Add a few times that work. No account, no group-chat
                back-and-forth.
              </p>
              <button
                className="button button-primary"
                type="button"
                onClick={() => setEditing(true)}
              >
                {view.isCreator ? "Add your availability" : "Add yourself"}
              </button>
            </section>
          )}
          {!view.isCreator && (
            <SharePanel
              slug={intent.publicSlug}
              creatorName={intent.creatorName}
            />
          )}
          <p className="invite-next">
            We&apos;re collecting everyone&apos;s availability. You can share
            this invite while replies come in.
          </p>
          <RepeatPlan surface="invite" />
        </>
      )}
    </div>
  );
}
