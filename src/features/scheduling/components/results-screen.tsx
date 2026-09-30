"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ResultsView, VoteValue } from "@/features/backend/results-types";
import { ApiError, requestApi } from "@/features/entry/client";
import { formatWindow } from "@/features/entry/components/availability-picker";
import { useAnalytics } from "@/lib/analytics/browser";
import { ProposalCard } from "./proposal-card";
export function ResultsScreen({ slug }: { slug: string }) {
  const [view, setView] = useState<ResultsView | null>(null),
    [error, setError] = useState<ApiError | null>(null),
    [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    confirmation = useRef<HTMLHeadingElement>(null),
    alert = useRef<HTMLParagraphElement>(null),
    tracked = useRef(false),
    track = useAnalytics();
  const path = `/api/intents/${encodeURIComponent(slug)}`;
  useEffect(() => {
    let active = true;
    requestApi<ResultsView>(`${path}/results`)
      .then((result) => {
        if (active) setView(result);
      })
      .catch((e) => {
        if (active) setError(e as ApiError);
      });
    return () => {
      active = false;
    };
  }, [path]);
  useEffect(() => {
    if (view && !tracked.current) {
      tracked.current = true;
      heading.current?.focus();
      track("result_viewed");
    }
  }, [view, track]);
  useEffect(() => {
    if (confirming) confirmation.current?.focus();
  }, [confirming]);
  async function load() {
    if (busy) return;
    setBusy(true);
    try {
      setView(await requestApi<ResultsView>(`${path}/results`));
      setError(null);
      setConfirming(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function act(suggestionKey: string, value?: VoteValue) {
    if (!view || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestApi<ResultsView>(
        `${path}/${value === undefined ? "decision" : "votes"}`,
        "POST",
        {
          suggestionKey,
          revision: view.revision,
          ...(value === undefined ? {} : { value }),
        },
      );
      setView(result);
      setConfirming(null);
    } catch (e) {
      setError(e as ApiError);
      requestAnimationFrame(() => alert.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  if (!view)
    return (
      <section className="message-page" aria-busy={!error}>
        <h1>
          {error
            ? error.code === "NOT_FOUND"
              ? "This plan couldn't be found."
              : "Your results are taking a moment."
            : "Finding a good time…"}
        </h1>
        {error ? (
          <>
            <p>Check the link or try loading this plan again.</p>
            <button
              className="button button-primary"
              type="button"
              disabled={busy}
              onClick={() => void load()}
            >
              Try again
            </button>
            <Link className="new-plan-link" href="/">
              Start a new plan
            </Link>
          </>
        ) : (
          <p role="status">A little less back-and-forth.</p>
        )}
      </section>
    );
  const decided =
      view.selectedSuggestionKey !== null || view.intent.status === "decided",
    expired = view.intent.status === "expired" && !decided,
    closed = decided || expired;
  const proposals = decided
    ? view.suggestions.filter(
        (p) => p.suggestionKey === view.selectedSuggestionKey,
      )
    : view.suggestions;
  const pending = view.suggestions.find((p) => p.suggestionKey === confirming);
  return (
    <div className="invite-page results-page">
      <div className="results-nav">
        <Link href={`/i/${slug}`}>← Back to the invite</Link>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh results
        </button>
      </div>
      <header className="invite-heading">
        <p className="eyebrow">Less planning. More living.</p>
        <h1 ref={heading} tabIndex={-1}>
          {decided ? "It's a plan." : "Your next moment, together."}
        </h1>
        <p className="invite-idea">{view.intent.rawText}</p>
        <p className="quiet-copy">
          Times in {Intl.DateTimeFormat().resolvedOptions().timeZone} ·{" "}
          {view.intent.participantCount}{" "}
          {view.intent.participantCount === 1 ? "person" : "people"} in the plan
        </p>
        {!closed && (
          <p className="quiet-copy">
            {view.summary.participantsWithAvailability} shared future
            availability · {view.summary.participantsMissingAvailability} still
            need to add times
          </p>
        )}
      </header>
      {error && (
        <div className="results-error">
          <p className="entry-error" ref={alert} tabIndex={-1} role="alert">
            {error.message}
          </p>
          <button
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={() => void load()}
          >
            Reload results
          </button>
        </div>
      )}
      {expired && (
        <p className="entry-error" role="status">
          This invite has expired. These are the saved options; start a new plan
          to keep it going.
        </p>
      )}
      {decided && (
        <p className="confirmed-message" role="status">
          Your organizer confirmed this time. Availability and voting are now
          closed.
        </p>
      )}
      {pending && !closed && (
        <section
          className="entry-card confirm-plan"
          aria-label="Confirm group plan"
        >
          <h2 ref={confirmation} tabIndex={-1}>
            Make this the group plan?
          </h2>
          <p>{formatWindow(pending.window)}</p>
          <p className="quiet-copy">
            Confirming closes availability and voting for everyone. You can keep
            collecting replies instead.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => void act(pending.suggestionKey)}
            >
              Confirm plan
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              Keep collecting
            </button>
          </div>
        </section>
      )}
      {proposals.length ? (
        proposals.map((p, index) => (
          <ProposalCard
            key={`${p.suggestionKey}:${view.revision}`}
            slug={slug}
            revision={view.revision}
            canAssist={view.isCreator || view.ownParticipant !== null}
            proposal={p}
            label={
              decided
                ? "Confirmed plan"
                : index === 0
                  ? "Best match"
                  : `Alternative ${index}`
            }
            canVote={view.canVote && !closed}
            canDecide={view.isCreator && !closed}
            busy={busy}
            onVote={(value) => void act(p.suggestionKey, value)}
            onChoose={() => setConfirming(p.suggestionKey)}
          />
        ))
      ) : (
        <section className="entry-card">
          <h2>A little more availability.</h2>
          <p className="quiet-copy">{view.message}</p>
          <Link className="button button-primary" href={`/i/${slug}`}>
            Add availability
          </Link>
        </section>
      )}
      {!closed && proposals.length > 0 && !view.canVote && !view.isCreator && (
        <section className="entry-card">
          <h2>Have a say in the plan.</h2>
          <p className="quiet-copy">
            Join to see your friends&apos; availability and vote on the times
            that work for you.
          </p>
          <Link className="button button-primary" href={`/i/${slug}`}>
            Join the plan
          </Link>
        </section>
      )}
      <Link className="new-plan-link" href="/">
        Another idea? Start a new plan →
      </Link>
    </div>
  );
}
