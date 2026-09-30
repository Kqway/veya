"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ParsedIntent } from "@/features/intents/structured";
import { IntentAssistance } from "./intent-assistance";
import { IntentHints } from "./intent-hints";
import type { IntentView } from "@/features/backend/types";
import { ensureGuest, requestApi } from "../client";
const activities = ["Coffee", "Dinner", "Walk", "Games", "Study", "Adventure"];
export function CreateDetails({
  idea,
  onEdit,
}: {
  idea: string;
  onEdit: () => void;
}) {
  const router = useRouter(),
    heading = useRef<HTMLHeadingElement>(null),
    alert = useRef<HTMLParagraphElement>(null);
  const [name, setName] = useState(""),
    [place, setPlace] = useState(""),
    [days, setDays] = useState("7");
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ParsedIntent["type"]>("general"),
    [hints, setHints] = useState<Pick<
      ParsedIntent,
      "dateHint" | "budgetHint"
    > | null>(null);
  const availableActivities = [...new Set([...activities, ...selected])];
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    heading.current?.focus();
    return () => {
      active.current = false;
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim() || name.trim().length > 60) {
      setError("Add your name, up to 60 characters.");
      requestAnimationFrame(() => alert.current?.focus());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureGuest();
      if (!active.current) return;
      const result = await requestApi<IntentView>("/api/intents", "POST", {
        rawText: idea,
        creatorName: name.trim(),
        structuredIntent: {
          type: kind,
          activities: selected.map((a) => a.toLowerCase()),
          location: place.trim() || null,
          ...(hints ?? {}),
        },
        expiresAt: new Date(Date.now() + Number(days) * 86400000).toISOString(),
      });
      if (active.current) router.push(`/i/${result.intent.publicSlug}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Please try again.");
      requestAnimationFrame(() => alert.current?.focus());
      if (active.current) setBusy(false);
    }
  }
  return (
    <form
      className="composer-card details-card"
      onSubmit={submit}
      noValidate
      aria-busy={busy}
    >
      <p className="eyebrow">A little detail. A real plan.</p>
      <h2 className="draft-title" tabIndex={-1} ref={heading}>
        {idea}
      </h2>
      <IntentAssistance
        idea={idea}
        disabled={busy}
        onApply={(parsed) => {
          setKind(parsed.type);
          setSelected(
            [...new Set(parsed.activities.map((a) => a.toLowerCase()))].map(
              (a) => a.charAt(0).toUpperCase() + a.slice(1),
            ),
          );
          setPlace(parsed.location ?? "");
          setHints({
            dateHint: parsed.dateHint,
            budgetHint: parsed.budgetHint,
          });
          requestAnimationFrame(() => heading.current?.focus());
        }}
      />
      <fieldset disabled={busy} className="plain-fieldset">
        <label className="field">
          Your name
          <input
            value={name}
            maxLength={60}
            autoComplete="given-name"
            onChange={(e) => setName(e.target.value)}
            placeholder="What should your friends call you?"
            required
          />
        </label>
        <label className="field">
          Collect replies for
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
          </select>
        </label>
        <label className="field">
          Kind of plan (optional)
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ParsedIntent["type"])}
          >
            <option value="general">Anything together</option>
            <option value="meet">Meet up</option>
            <option value="travel">Travel</option>
            <option value="game">Games</option>
            <option value="study">Study</option>
          </select>
        </label>
        <fieldset className="tag-fieldset">
          <legend>
            What sounds good? <span>(optional)</span>
          </legend>
          <div className="tag-list">
            {availableActivities.map((a) => (
              <button
                type="button"
                className="choice-chip"
                aria-pressed={selected.includes(a)}
                disabled={!selected.includes(a) && selected.length >= 10}
                key={a}
                onClick={() =>
                  setSelected(
                    selected.includes(a)
                      ? selected.filter((v) => v !== a)
                      : [...selected, a],
                  )
                }
              >
                {a}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="field">
          Place or area (optional)
          <input
            value={place}
            maxLength={120}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="A neighbourhood, city, or anywhere"
          />
        </label>
      </fieldset>
      {hints && (
        <div className="applied-hints">
          <IntentHints
            dateHint={hints.dateHint}
            budgetHint={hints.budgetHint}
          />
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => setHints(null)}
          >
            Remove date/budget hints
          </button>
        </div>
      )}
      {error && (
        <p className="entry-error" role="alert" tabIndex={-1} ref={alert}>
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button button-primary" disabled={busy} type="submit">
          {busy ? "Creating your invite…" : "Create invite"}
        </button>
        <button
          className="button button-secondary"
          disabled={busy}
          type="button"
          onClick={onEdit}
        >
          Edit your idea
        </button>
      </div>
      <p className="quiet-copy">
        No account needed. Your friends add their own availability.
      </p>
    </form>
  );
}
