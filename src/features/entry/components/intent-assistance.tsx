"use client";
import { useEffect, useRef, useState } from "react";
import type { ParsedIntent } from "@/features/intents/structured";
import type { TaskResult } from "@/lib/ai/types";
import { requestApi } from "../client";
import { dateKey } from "../form-values";
import { IntentHints } from "./intent-hints";
export function IntentAssistance({
  idea,
  disabled,
  onApply,
}: {
  idea: string;
  disabled: boolean;
  onApply: (value: ParsedIntent) => void;
}) {
  const [suggested, setSuggested] = useState<ParsedIntent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const active = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function help() {
    if (busy || disabled) return;
    setBusy(true);
    setError(false);
    setSuggested(null);
    try {
      const result = await requestApi<TaskResult<ParsedIntent>>(
        "/api/ai/intent",
        "POST",
        {
          text: idea,
          referenceDate: dateKey(new Date()),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      );
      if (active.current) {
        setSuggested(result.data);
        requestAnimationFrame(() => heading.current?.focus());
      }
    } catch {
      if (active.current) setError(true);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  function dismiss() {
    setSuggested(null);
    button.current?.focus();
  }
  return (
    <section className="intent-assistance" aria-label="Optional idea details">
      <button
        className="button button-secondary"
        type="button"
        disabled={disabled || busy}
        ref={button}
        onClick={() => void help()}
      >
        {busy ? "Finding a starting point…" : "Help with details"}
      </button>
      <p className="quiet-copy">
        Optional suggestions may use AI. Check them before sharing.
      </p>
      {error && (
        <p className="quiet-copy" role="status">
          You can keep adding details yourself, or try the helper again.
        </p>
      )}
      {suggested && (
        <div className="assistance-preview">
          <h3 ref={heading} tabIndex={-1}>
            Suggested details
          </h3>
          <p>Kind of plan: {suggested.type}</p>
          <p>
            Activities:{" "}
            {suggested.activities.join(", ") || "Choose what sounds good"}
          </p>
          <p>Place: {suggested.location || "Choose together"}</p>
          <IntentHints
            dateHint={suggested.dateHint}
            budgetHint={suggested.budgetHint}
          />
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={disabled}
              onClick={() => {
                onApply(suggested);
                setSuggested(null);
              }}
            >
              Apply details
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={disabled}
              onClick={dismiss}
            >
              Keep my details
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
