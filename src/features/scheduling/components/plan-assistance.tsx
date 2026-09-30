"use client";
import { useEffect, useRef, useState } from "react";
import type { PlanAssistanceResult } from "@/lib/ai/types";
import { ApiError, requestApi } from "@/features/entry/client";
export function PlanAssistance({
  slug,
  suggestionKey,
  revision,
  disabled,
}: {
  slug: string;
  suggestionKey: string;
  revision: number;
  disabled: boolean;
}) {
  const [result, setResult] = useState<PlanAssistanceResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function help() {
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const response = await requestApi<PlanAssistanceResult>(
        `/api/intents/${encodeURIComponent(slug)}/assist`,
        "POST",
        { suggestionKey, revision },
      );
      if (
        response.suggestionKey !== suggestionKey ||
        response.revision !== revision
      )
        throw new ApiError("STALE_RESULTS", 409);
      if (active.current) setResult(response);
    } catch (e) {
      if (active.current)
        setError(
          e instanceof ApiError && e.code === "STALE_RESULTS"
            ? "These suggestions changed. Refresh results before asking for an idea."
            : e instanceof ApiError && e.code === "UNAUTHORIZED"
              ? "Your session has ended. Reload this page to continue."
              : "We couldn't add a suggestion. Your plan still works; try again when you're ready.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <div className="plan-assistance">
      {!result && (
        <>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || disabled}
            onClick={() => void help()}
          >
            {busy ? "Thinking of an idea…" : "Get a meetup idea"}
          </button>
          <p className="quiet-copy">
            Optional ideas may use AI. Your group decides the details.
          </p>
        </>
      )}
      {error && (
        <p className="quiet-copy" role="status">
          {error}
        </p>
      )}
      {result && (
        <section className="meetup-idea" aria-label="Meetup idea">
          <h3>A meetup idea</h3>
          <p className="meetup-title">{result.idea.data.title}</p>
          <p>{result.idea.data.idea}</p>
          <p className="quiet-copy">{result.explanation.data.explanation}</p>
        </section>
      )}
    </div>
  );
}
