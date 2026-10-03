"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ParsedIntent } from "@/features/intents/structured";
import { IntentAssistance } from "./intent-assistance";
import { IntentHints } from "./intent-hints";
import type { IntentView } from "@/features/backend/types";
import { ensureGuest, requestApi } from "../client";
import { activityLabel } from "@/features/intents/labels";
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
      setError("Укажите имя, не более 60 символов.");
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
      setError(error instanceof Error ? error.message : "Попробуйте ещё раз.");
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
      <p className="eyebrow">Пара деталей — и план готов.</p>
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
          Ваше имя
          <input
            value={name}
            maxLength={60}
            autoComplete="given-name"
            onChange={(e) => setName(e.target.value)}
            placeholder="Как вас называть?"
            required
          />
        </label>
        <label className="field">
          Срок сбора ответов
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="3">3 дня</option>
            <option value="7">7 дней</option>
            <option value="14">14 дней</option>
          </select>
        </label>
        <label className="field">
          Тип встречи (необязательно)
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ParsedIntent["type"])}
          >
            <option value="general">Что угодно вместе</option>
            <option value="meet">Встреча</option>
            <option value="travel">Поездка</option>
            <option value="game">Игры</option>
            <option value="study">Учёба</option>
          </select>
        </label>
        <fieldset className="tag-fieldset">
          <legend>
            Чем хотите заняться? <span>(необязательно)</span>
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
                {activityLabel(a)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="field">
          Место или район (необязательно)
          <input
            value={place}
            maxLength={120}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="Район, город или любое место"
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
            Убрать подсказки о датах и бюджете
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
          {busy ? "Создаём приглашение…" : "Создать приглашение"}
        </button>
        <button
          className="button button-secondary"
          disabled={busy}
          type="button"
          onClick={onEdit}
        >
          Изменить идею
        </button>
      </div>
      <p className="quiet-copy">
        Регистрация не нужна. Друзья сами укажут свободное время.
      </p>
    </form>
  );
}
