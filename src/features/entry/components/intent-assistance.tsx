"use client";
import { useEffect, useRef, useState } from "react";
import type { ParsedIntent } from "@/features/intents/structured";
import type { TaskResult } from "@/lib/ai/types";
import { requestApi } from "../client";
import { dateKey } from "../form-values";
import { IntentHints } from "./intent-hints";
import { activityLabel, intentTypeLabels } from "@/features/intents/labels";
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
    <section className="intent-assistance" aria-label="Дополнительные детали идеи">
      <button
        className="button button-secondary"
        type="button"
        disabled={disabled || busy}
        ref={button}
        onClick={() => void help()}
      >
        {busy ? "Подбираем детали…" : "Помочь с деталями"}
      </button>
      <p className="quiet-copy">
        Подсказки могут быть созданы с помощью ИИ. Проверьте их перед отправкой.
      </p>
      {error && (
        <p className="quiet-copy" role="status">
          Добавьте детали сами или попробуйте помощника ещё раз.
        </p>
      )}
      {suggested && (
        <div className="assistance-preview">
          <h3 ref={heading} tabIndex={-1}>
            Предложенные детали
          </h3>
          <p>Тип встречи: {intentTypeLabels[suggested.type]}</p>
          <p>
            Занятия:{" "}
            {suggested.activities.map(activityLabel).join(", ") || "Выберите занятие"}
          </p>
          <p>Место: {suggested.location || "Выберите вместе"}</p>
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
              Применить детали
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={disabled}
              onClick={dismiss}
            >
              Оставить мои детали
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
