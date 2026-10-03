"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
  const active = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    nameInput.current?.focus();
    return () => {
      active.current = false;
    };
  }, []);
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
      validateEntryAvailability(
        availability,
        view.intent.expiresAt,
        new Date(),
        view.ownParticipant?.availability ?? [],
      );
      setBusy(true);
      const path = `/api/intents/${view.intent.publicSlug}/participants`;
      if (existing) {
        const result = await requestApi<IntentView>(`${path}/me`, "PUT", data);
        if (active.current) onSaved(result);
      } else {
        await ensureGuest();
        if (!active.current) return;
        const result = await requestApi<IntentView>(path, "POST", data);
        if (active.current) onSaved(result);
      }
    } catch (e) {
      if (!active.current) return;
      setError((e as Error).message);
      requestAnimationFrame(() => alert.current?.focus());
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <form
      className="entry-card participant-form"
      onSubmit={submit}
      noValidate
      aria-busy={busy}
    >
      <h2>{existing ? "Ваши данные" : "Присоединяйтесь к встрече"}</h2>
      <p className="quiet-copy">
        Без регистрации. Только имя и подходящее время.
      </p>
      <fieldset disabled={busy} className="plain-fieldset">
        <label className="field">
          Ваше имя
          <input
            ref={nameInput}
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
          saved={view.ownParticipant?.availability ?? []}
        />
        <details className="optional-details">
          <summary>Бюджет, предпочтения и заметка (необязательно)</summary>
          <div className="budget-fields">
            <label className="field">
              Минимальный бюджет
              <input
                {...field("budgetMin")}
                inputMode="decimal"
                placeholder="Без минимальной суммы"
              />
            </label>
            <label className="field">
              Максимальный бюджет
              <input
                {...field("budgetMax")}
                inputMode="decimal"
                placeholder="Без ограничений"
              />
            </label>
            <label className="field">
              Валюта
              <select {...field("currency")}>
                {[...new Set([...currencies, fields.currency])].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            Занятия
            <input {...field("activity")} placeholder="Кофе, игры, прогулка" />
          </label>
          <label className="field">
            Предпочтения в еде
            <input {...field("dietary")} placeholder="Вегетарианское меню, без орехов" />
          </label>
          <label className="field">
            Предпочтения по месту
            <input
              {...field("location")}
              placeholder="Рядом со станцией, на свежем воздухе"
            />
          </label>
          <p className="quiet-copy">
            Разделяйте предпочтения запятыми; значения с запятыми берите в кавычки.
            Участники увидят ваше имя и свободное время для предложенных встреч.
            Заметки и подробные предпочтения останутся личными.
          </p>
          <label className="field">
            Заметка (необязательно)
            <textarea
              {...field("notes")}
              maxLength={1000}
              rows={3}
              placeholder="Что ещё стоит учесть?"
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
          {busy ? "Сохраняем…" : existing ? "Сохранить изменения" : "Присоединиться к встрече"}
        </button>
        <button
          className="button button-secondary"
          disabled={busy}
          type="button"
          onClick={onCancel}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
