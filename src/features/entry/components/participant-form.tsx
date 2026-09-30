"use client";
import { useRef, useState, type FormEvent } from "react";
import type { IntentView } from "@/features/backend/types";
import { ensureGuest, requestApi } from "../client";
import {
  currencies,
  fieldsFromParticipant,
  participantFromForm,
  validateEntryAvailability,
} from "../form-values";
import { AvailabilityPicker } from "./availability-picker";
export function ParticipantForm({
  view,
  onSaved,
  onCancel,
}: {
  view: IntentView;
  onSaved: (view: IntentView) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState(() =>
    fieldsFromParticipant(view.ownParticipant),
  );
  const [availability, setAvailability] = useState(
    () => view.ownParticipant?.availability ?? [],
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    alert = useRef<HTMLParagraphElement>(null);
  const existing = Boolean(view.ownParticipant);
  function field(key: keyof typeof fields) {
    return {
      value: fields[key],
      onChange: (
        e: React.ChangeEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >,
      ) => setFields({ ...fields, [key]: e.target.value }),
    };
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    try {
      const data = participantFromForm(
        fields,
        availability,
        view.ownParticipant,
      );
      validateEntryAvailability(availability, view.intent.expiresAt);
      setBusy(true);
      const path = `/api/intents/${view.intent.publicSlug}/participants`;
      if (existing)
        onSaved(await requestApi<IntentView>(`${path}/me`, "PUT", data));
      else {
        await ensureGuest();
        const result = await requestApi<IntentView>(path, "POST", data);
        onSaved(result);
      }
    } catch (e) {
      setError((e as Error).message);
      requestAnimationFrame(() => alert.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="entry-card participant-form"
      onSubmit={submit}
      noValidate
      aria-busy={busy}
    >
      <h2>{existing ? "Your details" : "Make room for yourself"}</h2>
      <p className="quiet-copy">
        No signup. Just your name and a time that works.
      </p>
      <fieldset disabled={busy} className="plain-fieldset">
        <label className="field">
          Display name
          <input
            {...field("displayName")}
            maxLength={60}
            autoComplete="given-name"
            required
          />
        </label>
        <AvailabilityPicker
          value={availability}
          onChange={setAvailability}
          expiresAt={view.intent.expiresAt}
        />
        <details className="optional-details">
          <summary>Budget, preferences & a note (optional)</summary>
          <div className="budget-fields">
            <label className="field">
              Minimum budget
              <input
                {...field("budgetMin")}
                inputMode="decimal"
                placeholder="No minimum"
              />
            </label>
            <label className="field">
              Maximum budget
              <input
                {...field("budgetMax")}
                inputMode="decimal"
                placeholder="No limit"
              />
            </label>
            <label className="field">
              Currency
              <select {...field("currency")}>
                {[...new Set([...currencies, fields.currency])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            Activities
            <input {...field("activity")} placeholder="Coffee, games, a walk" />
          </label>
          <label className="field">
            Food preferences
            <input {...field("dietary")} placeholder="Vegetarian, no nuts" />
          </label>
          <label className="field">
            Location preferences
            <input
              {...field("location")}
              placeholder="Near the station, outdoors"
            />
          </label>
          <p className="quiet-copy">
            Separate preferences with commas. Your details stay private.
          </p>
          <label className="field">
            Optional note
            <textarea
              {...field("notes")}
              maxLength={1000}
              rows={3}
              placeholder="Anything else that would help?"
            />
          </label>
        </details>
      </fieldset>
      {error && (
        <p className="entry-error" role="alert" tabIndex={-1} ref={alert}>
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button button-primary" disabled={busy} type="submit">
          {busy ? "Saving…" : existing ? "Save changes" : "Join the plan"}
        </button>
        <button
          className="button button-secondary"
          disabled={busy}
          type="button"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
