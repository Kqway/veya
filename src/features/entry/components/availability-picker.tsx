"use client";
import { useState } from "react";
import {
  localWindow,
  nextDays,
  validateEntryAvailability,
  type Availability,
} from "../form-values";
const presets = [
  { name: "Morning", start: "09:00", end: "12:00" },
  { name: "Afternoon", start: "12:00", end: "17:00" },
  { name: "Evening", start: "17:00", end: "22:00" },
];
export function formatWindow(window: Availability): string {
  return `${new Date(window.startAt).toLocaleString("en", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} – ${new Date(window.endAt).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}`;
}
export function AvailabilityPicker({
  value,
  onChange,
  expiresAt,
}: {
  value: Availability[];
  onChange: (value: Availability[]) => void;
  expiresAt: string;
}) {
  const [days] = useState(() => nextDays()),
    [date, setDate] = useState(() => nextDays()[1]!.date);
  const [start, setStart] = useState("18:00"),
    [end, setEnd] = useState("20:00"),
    [error, setError] = useState<string | null>(null);
  function add(window: Availability) {
    try {
      validateEntryAvailability([...value, window], expiresAt);
      onChange([...value, window]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <fieldset className="availability-picker">
      <legend>When are you free?</legend>
      <p className="quiet-copy">
        Next 7 days · Times in{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}. Morning 9–12,
        afternoon 12–17, evening 17–22.
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
        <summary>Choose custom times</summary>
        <div className="custom-time-fields">
          <label className="field">
            Date
            <input
              type="date"
              value={date}
              min={days[0]!.date}
              max={days[6]!.date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="field">
            Start time
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label className="field">
            End time
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => {
            try {
              if (date < days[0]!.date || date > days[6]!.date)
                throw new Error("Choose a date in the next 7 days.");
              add(localWindow(date, start, end));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Add time
        </button>
      </details>
      {error && (
        <p className="entry-error" role="alert">
          {error}
        </p>
      )}
      {value.length > 0 && (
        <ul className="selected-times" aria-label="Selected availability">
          {value.map((w, index) => (
            <li key={`${w.startAt}-${w.endAt}`}>
              <span>{formatWindow(w)}</span>
              <button
                type="button"
                aria-label={`Remove time ${index + 1}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
