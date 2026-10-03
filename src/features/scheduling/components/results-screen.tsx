"use client";
import Link from "next/link";
import { RepeatPlan } from "@/features/entry/components/repeat-plan";
import { LoadingPlan } from "@/features/entry/components/loading-plan";
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
  if (!view && !error) return <LoadingPlan results />;
  if (!view)
    return (
      <section className="message-page" aria-busy={!error}>
        <h1>
          {error
            ? error.code === "NOT_FOUND"
              ? "План не найден."
              : "Результаты загружаются чуть дольше обычного."
            : "Ищем подходящее время…"}
        </h1>
        {error ? (
          <>
            <p>Проверьте ссылку или попробуйте загрузить план ещё раз.</p>
            <button
              className="button button-primary"
              type="button"
              disabled={busy}
              onClick={() => void load()}
            >
              Попробовать ещё раз
            </button>
            <Link className="new-plan-link" href="/">
              Создать новый план
            </Link>
          </>
        ) : (
          <p role="status">Меньше переписки.</p>
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
        <Link href={`/i/${slug}`}>← К приглашению</Link>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Обновить результаты
        </button>
      </div>
      <header className="invite-heading">
        <p className="eyebrow">Меньше хлопот. Больше встреч.</p>
        <h1 ref={heading} tabIndex={-1}>
          {decided ? "Встреча запланирована." : "Ваша следующая встреча."}
        </h1>
        <p className="invite-idea">{view.intent.rawText}</p>
        <p className="quiet-copy">
          Часовой пояс: {Intl.DateTimeFormat().resolvedOptions().timeZone} ·{" "}
          Участников в плане: {view.intent.participantCount}
        </p>
        {!closed && (
          <p className="quiet-copy">
            Указали свободное время: {view.summary.participantsWithAvailability}
            {" · "}Ещё не ответили: {view.summary.participantsMissingAvailability}
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
            Перезагрузить результаты
          </button>
        </div>
      )}
      {expired && (
        <p className="entry-error" role="status">
          Срок приглашения истёк. Здесь сохранены варианты встречи.
          Создайте новый план, чтобы продолжить.
        </p>
      )}
      {decided && (
        <p className="confirmed-message" role="status">
          Организатор подтвердил это время. Сбор свободного времени
          и голосование завершены.
        </p>
      )}
      {pending && !closed && (
        <section
          className="entry-card confirm-plan"
          aria-label="Подтверждение плана встречи"
        >
          <h2 ref={confirmation} tabIndex={-1}>
            Подтвердить этот вариант для всех?
          </h2>
          <p>{formatWindow(pending.window)}</p>
          <p className="quiet-copy">
            После подтверждения сбор свободного времени и голосование завершатся
            для всех. Можно пока продолжить собирать ответы.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => void act(pending.suggestionKey)}
            >
              Подтвердить план
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              Продолжить сбор ответов
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
                ? "Подтверждённый план"
                : index === 0
                  ? "Лучший вариант"
                  : `Вариант ${index}`
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
          <h2>Нужно ещё немного свободного времени.</h2>
          <p className="quiet-copy">{view.message}</p>
          <Link className="button button-primary" href={`/i/${slug}`}>
            Указать свободное время
          </Link>
        </section>
      )}
      {!closed && proposals.length > 0 && !view.canVote && !view.isCreator && (
        <section className="entry-card">
          <h2>Участвуйте в выборе времени.</h2>
          <p className="quiet-copy">
            Присоединитесь, чтобы увидеть свободное время друзей
            и проголосовать за подходящие варианты встречи.
          </p>
          <Link className="button button-primary" href={`/i/${slug}`}>
            Присоединиться к встрече
          </Link>
        </section>
      )}
      <RepeatPlan surface="result" />
    </div>
  );
}
