"use client";
import { useState } from "react";
import {
  localWindow,
  dateKey,
  nextDays,
  validateEntryAvailability,
  type Availability,
} from "../form-values";
const presets = [
  { name: "Утро", start: "09:00", end: "12:00" },
  { name: "День", start: "12:00", end: "17:00" },
  { name: "Вечер", start: "17:00", end: "22:00" },
];
export function formatWindow(window: Availability): string {
  const start = new Date(window.startAt),
    end = new Date(window.endAt);
  const options = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  } as const;
  return `${start.toLocaleString("ru-RU", options)} – ${start.toDateString() === end.toDateString() ? end.toLocaleTimeString("ru-RU", { hour: "numeric", minute: "2-digit" }) : end.toLocaleString("ru-RU", options)}`;
}
export function AvailabilityPicker({
  value,
  onChange,
  expiresAt,
  saved = [],
}: {
  value: Availability[];
  onChange: (value: Availability[]) => void;
  expiresAt: string;
  saved?: Availability[];
}) {
  const [days] = useState(() => nextDays()),
    [date, setDate] = useState(() => nextDays()[1]!.date);
  const [start, setStart] = useState("18:00"),
    [end, setEnd] = useState("20:00"),
    [error, setError] = useState<string | null>(null);
  const [overnight, setOvernight] = useState(false);
  function add(window: Availability) {
    try {
      validateEntryAvailability(
        [...value, window],
        expiresAt,
        new Date(),
        saved,
      );
      onChange([...value, window]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <fieldset className="availability-picker">
      <legend>Когда у вас есть свободное время?</legend>
      <p className="quiet-copy">
        Ближайшие 7 дней · Часовой пояс:{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}. Утро 9–12,
        день 12–17, вечер 17–22.
      </p>
      <p className="availability-feedback" role="status">
        {value.length
          ? `Выбрано промежутков: ${value.length}. Можно добавить ещё.`
          : "Выберите время ниже. Для начала достаточно одного промежутка."}
      </p>
      <div className="day-list">
        {days.map((day) => (
          <div className="day-row" key={day.date}>
            <span>{day.label}</span>
            <div>
              {presets.map((p) => {
                let window: Availability | null = null;
                try {
                  window = localWindow(day.date, p.start, p.end);
                } catch {}
                const selected = value.some(
                  (w) =>
                    w.startAt === window?.startAt && w.endAt === window?.endAt,
                );
                let allowed = true;
                try {
                  validateEntryAvailability(window ? [window] : [], expiresAt);
                } catch {
                  allowed = false;
                }
                return (
                  <button
                    key={p.name}
                    type="button"
                    className="choice-chip"
                    disabled={!selected && !allowed}
                    aria-pressed={selected}
                    aria-label={`${p.name} ${day.label}`}
                    onClick={() => {
                      if (!window) return;
                      if (selected) {
                        onChange(
                          value.filter(
                            (w) =>
                              w.startAt !== window.startAt ||
                              w.endAt !== window.endAt,
                          ),
                        );
                        setError(null);
                      } else add(window);
                    }}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <details className="custom-times">
        <summary>Указать другое время</summary>
        <div className="custom-time-fields">
          <label className="field">
            Дата
            <input
              type="date"
              value={date}
              min={days[0]!.date}
              max={days[6]!.date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="field">
            Время начала
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="field">
            Время окончания
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <label className="overnight-choice">
          <input
            type="checkbox"
            checked={overnight}
            onChange={(e) => setOvernight(e.target.checked)}
          />{" "}
          Заканчивается на следующий день
        </label>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            try {
              if (date < days[0]!.date || date > days[6]!.date)
                throw new Error("Выберите дату в ближайшие 7 дней.");
              const next = new Date(`${date}T12:00:00`);
              next.setDate(next.getDate() + 1);
              add(
                localWindow(date, start, end, overnight ? dateKey(next) : date),
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Добавить время
        </button>
      </details>
      {error && (
        <p className="entry-error" role="alert">
          {error}
        </p>
      )}
      {value.length > 0 && (
        <ul className="selected-times" aria-label="Выбранное свободное время">
          {value.map((w, index) => (
            <li key={`${w.startAt}-${w.endAt}`}>
              <span>{formatWindow(w)}</span>
              <button
                type="button"
                aria-label={`Удалить промежуток ${index + 1}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                Удалить
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
