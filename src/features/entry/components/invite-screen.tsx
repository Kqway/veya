"use client";
import { RepeatPlan } from "./repeat-plan";
import { LoadingPlan } from "./loading-plan";
import { IntentHints } from "./intent-hints";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { IntentView } from "@/features/backend/types";
import { useAnalytics } from "@/lib/analytics/browser";
import { ApiError, requestApi } from "../client";
import { formatMoney } from "../form-values";
import { formatWindow } from "./availability-picker";
import { ParticipantForm } from "./participant-form";
import { SharePanel } from "./share-panel";
import { activityLabel } from "@/features/intents/labels";
export function InviteScreen({ slug }: { slug: string }) {
  const [view, setView] = useState<IntentView | null>(null),
    [error, setError] = useState<ApiError | null>(null),
    [editing, setEditing] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null),
    track = useAnalytics(),
    tracked = useRef(false);
  useEffect(() => {
    let active = true;
    requestApi<IntentView>(`/api/intents/${encodeURIComponent(slug)}`)
      .then((result) => {
        if (active) {
          setView(result);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(e as ApiError);
      });
    return () => {
      active = false;
    };
  }, [slug]);
  useEffect(() => {
    if (view) {
      heading.current?.focus();
      if (!tracked.current) {
        tracked.current = true;
        track("invite_opened");
      }
    }
  }, [view, track]);
  async function retry() {
    setError(null);
    try {
      setView(
        await requestApi<IntentView>(
          `/api/intents/${encodeURIComponent(slug)}`,
        ),
      );
    } catch (e) {
      setError(e as ApiError);
    }
  }
  if (error && !view)
    return (
      <section className="message-page">
        <p className="eyebrow">Небольшая заминка</p>
        <h1>
          {error.code === "NOT_FOUND"
            ? "Приглашение не найдено."
            : "План загружается чуть дольше обычного."}
        </h1>
        <p>
          {error.code === "NOT_FOUND"
            ? "Уточните ссылку у друга или создайте новый совместный план."
            : "Не удалось загрузить план. Попробуйте ещё раз."}
        </p>
        <div className="form-actions">
          {error.code !== "NOT_FOUND" && (
            <button
              className="button button-primary"
              onClick={() => void retry()}
            >
              Попробовать ещё раз
            </button>
          )}
          <Link className="button button-secondary" href="/">
            Создать новый план
          </Link>
        </div>
      </section>
    );
  if (!view) return <LoadingPlan />;
  const { intent, ownParticipant } = view,
    closed = intent.status === "expired" || intent.status === "decided";
  return (
    <div className="invite-page">
      <section className="invite-heading">
        <p className="eyebrow">Ваша идея. Ваша компания.</p>
        <h1 ref={heading} tabIndex={-1}>
          {view.isCreator
            ? "План готов. Приглашайте друзей."
            : `${intent.creatorName} предлагает встретиться.`}
        </h1>
        <p className="invite-idea">{intent.rawText}</p>
        {(intent.structuredIntent.activities.length > 0 ||
          intent.structuredIntent.location) && (
          <div className="intent-tags">
            {intent.structuredIntent.activities.map((a) => (
              <span key={a}>{activityLabel(a)}</span>
            ))}
            {intent.structuredIntent.location && (
              <span>{intent.structuredIntent.location}</span>
            )}
          </div>
        )}
        <IntentHints
          dateHint={intent.structuredIntent.dateHint}
          budgetHint={intent.structuredIntent.budgetHint}
        />
        <p className="quiet-copy">
          Свободное время указали: <strong>{intent.participantCount}</strong> · Ответить можно до{" "}
          {new Date(intent.expiresAt).toLocaleDateString("ru-RU", {
            month: "short",
            day: "numeric",
          })}
        </p>
      </section>
      <div className="results-entry">
        <Link
          className="button button-primary"
          href={`/i/${intent.publicSlug}/results`}
        >
          {intent.status === "decided"
            ? "Посмотреть подтверждённый план"
            : "Найти общее время"}
        </Link>
        <p className="quiet-copy">
          Общее время, подходящие компромиссы и право голоса для каждого.
        </p>
      </div>
      {closed ? (
        <section className="entry-card closed-plan">
          <h2>
            {intent.status === "decided"
              ? "Этот план больше нельзя изменить."
              : "Срок приглашения истёк."}
          </h2>
          <p>
            Сохраните хорошую идею: создайте новый план и пригласите друзей.
          </p>
          <Link className="button button-primary" href="/">
            Создать новый план
          </Link>
        </section>
      ) : (
        <>
          {view.isCreator && (
            <SharePanel
              slug={intent.publicSlug}
              creatorName={intent.creatorName}
            />
          )}
          {editing ? (
            <ParticipantForm
              view={view}
              onSaved={(result) => {
                setView(result);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : ownParticipant ? (
            <section className="entry-card own-details">
              <p className="eyebrow">Вы участвуете во встрече</p>
              <h2>Вы с нами, {ownParticipant.displayName}.</h2>
              <p className="quiet-copy">
                Ваше свободное время сохранено. Чтобы изменить его, откройте
                приглашение в этом же браузере.
              </p>
              <ul className="saved-times">
                {ownParticipant.availability.map((w) => (
                  <li key={`${w.startAt}-${w.endAt}`}>{formatWindow(w)}</li>
                ))}
              </ul>
              {ownParticipant.budgetMax !== null && (
                <p>
                  Максимальный бюджет:{" "}
                  {formatMoney(
                    ownParticipant.budgetMax,
                    ownParticipant.currency,
                  )}{" "}
                  {ownParticipant.currency}
                </p>
              )}
              {ownParticipant.preferences.length > 0 && (
                <p className="quiet-copy">
                  {ownParticipant.preferences.map((p) => p.value).join(" · ")}
                </p>
              )}
              {ownParticipant.notes && (
                <p className="participant-note">{ownParticipant.notes}</p>
              )}
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setEditing(true)}
              >
                Изменить данные
              </button>
            </section>
          ) : (
            <section className="entry-card join-card">
              <h2>
                {view.isCreator
                  ? "Сделайте первый шаг."
                  : "Хорошая встреча начинается с вас."}
              </h2>
              <p className="quiet-copy">
                Укажите подходящее время. Без регистрации и долгой переписки
                в общем чате.
              </p>
              <button
                className="button button-primary"
                type="button"
                onClick={() => setEditing(true)}
              >
                {view.isCreator ? "Указать свободное время" : "Присоединиться"}
              </button>
            </section>
          )}
          {!view.isCreator && (
            <SharePanel
              slug={intent.publicSlug}
              creatorName={intent.creatorName}
            />
          )}
          <p className="invite-next">
            Собираем свободное время участников. Пока приходят ответы,
            можно поделиться приглашением.
          </p>
          <RepeatPlan surface="invite" />
        </>
      )}
    </div>
  );
}
