"use client";
import type { Presentation } from "@/features/profile-space/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, requestApi } from "@/features/entry/client";
export { ensureGuest } from "@/features/entry/client";
export type PrivacyMode = "OPEN" | "PRIVATE" | "INCOGNITO";
export type Profile = {
  alias: string;
  privacyMode: PrivacyMode;
  avatarSeed: string;
  ageBand: string | null;
  languages: string[];
  hasRecoveryKey: boolean;
};
export type Identity = { alias: string; avatarSeed: string };
export type SeekingInput = {
  rawText: string;
  activityKey: string;
  activityLabel: string;
  interactionMode: "in_person" | "online" | "either";
  format: "one_to_one" | "group" | "either";
  city: string | null;
  area: string | null;
  availability: { startAt: string; endAt: string }[];
  skill: "beginner" | "casual" | "intermediate" | "advanced" | "expert" | "any";
  languages: string[];
  tags: string[];
  desiredAgeBands: string[];
  groupSize: number | null;
  privacyMode?: PrivacyMode;
  expiresAt?: string;
};
export type OwnPost = SeekingInput & {
  publicKey: string;
  status: "active" | "closed" | "expired";
  expiresAt: string;
  privacyMode: PrivacyMode;
};
export type Suggestion = {
  activityKey: string | null;
  activityLabel: string | null;
  interactionMode: SeekingInput["interactionMode"] | null;
  format: SeekingInput["format"] | null;
  city: string | null;
  area: string | null;
  skill: SeekingInput["skill"] | null;
  languages: string[];
  tags: string[];
  timeHint: string | null;
};
export type Card = {
  handle: string;
  identity: Identity;
  presentation?: Presentation;
  activityLabel: string;
  interactionMode: SeekingInput["interactionMode"];
  format: SeekingInput["format"];
  reasons: string[];
  timeHint: string;
};
export type Connection = {
  publicKey: string;
  direction: "incoming" | "outgoing";
  status: "pending" | "accepted" | "declined" | "expired";
  identity: Identity;
  activityLabel: string;
  matchKey: string | null;
};
export type Match = {
  publicKey: string;
  status: "active" | "closed";
  identity: Identity;
  ownIdentity: Identity;
  activityLabel: string;
  disclosures: {
    kind: "first_name" | "contact_handle";
    value: string;
    isMine: boolean;
  }[];
  planSlug: string | null;
};
export type Message = {
  publicKey: string;
  text: string;
  createdAt: string;
  isMine: boolean;
  identity: Identity;
};
export const socialApi = <T>(path: string, method = "GET", body?: unknown) =>
  requestApi<T>(`/api/social${path}`, method, body);
export function socialError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Ваша сессия завершена. Обновите страницу, чтобы продолжить, или восстановите профиль с помощью Ключа Intavro.";
    if (error.status === 403 || error.status === 404)
      return "Этот объект недоступен в этой сессии.";
    if (error.status === 409)
      return "Это действие больше недоступно либо достигнут лимит активных заявок или запросов. Обновите страницу и попробуйте снова.";
  }
  return error instanceof Error && /[А-Яа-яЁё]/u.test(error.message)
    ? error.message
    : "Не удалось выполнить действие. Попробуйте снова.";
}
export function useSocialAction() {
  const alive = useRef(true),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const run = useCallback(
    async (work: (isAlive: () => boolean) => Promise<void>) => {
      if (!alive.current || locked.current) return;
      locked.current = true;
      setBusy(true);
      setError(null);
      try {
        await work(() => alive.current);
      } catch (e) {
        if (alive.current) setError(socialError(e));
      } finally {
        locked.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [],
  );
  return { busy, error, errorRef, run };
}
export function csv(
  text: string,
  max: number,
  itemLength: number,
  required = false,
): string[] {
  const values = text
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (
    (required && !values.length) ||
    values.length > max ||
    values.some((v) => v.length > itemLength) ||
    new Set(values).size !== values.length
  )
    throw new Error(
      `Укажите ${required ? "от 1 до " : "до "}${max} разных значений через запятую, каждое длиной до ${itemLength} символов.`,
    );
  return values;
}
export const ageBands = ["18-20", "21-24", "25-29", "30-39", "40+"];
export const privacyModes: PrivacyMode[] = ["OPEN", "PRIVATE", "INCOGNITO"];

export const privacyLabels: Record<PrivacyMode, string> = {
  OPEN: "Открытый",
  PRIVATE: "Приватный",
  INCOGNITO: "Инкогнито",
};
export const interactionLabels: Record<SeekingInput["interactionMode"], string> = {
  in_person: "Вживую",
  online: "Онлайн",
  either: "Любой вариант",
};
export const formatLabels: Record<SeekingInput["format"], string> = {
  one_to_one: "Вдвоём",
  group: "В группе",
  either: "Любой вариант",
};
export const skillLabels: Record<SeekingInput["skill"], string> = {
  any: "Любой уровень",
  beginner: "Начинающий",
  casual: "Любитель",
  intermediate: "Средний",
  advanced: "Продвинутый",
  expert: "Эксперт",
};
export const postStatusLabels: Record<OwnPost["status"], string> = {
  active: "Активна",
  closed: "Закрыта",
  expired: "Срок действия истёк",
};
export const connectionStatusLabels: Record<Connection["status"], string> = {
  pending: "Ожидает ответа",
  accepted: "Принят",
  declined: "Отклонён",
  expired: "Срок действия истёк",
};
