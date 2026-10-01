"use client";
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
      return "Your session has ended. Reload to continue or recover your profile with your Veya Key.";
    if (error.status === 403 || error.status === 404)
      return "This item is unavailable to this session.";
    if (error.status === 409)
      return "This action is no longer available, or your active posts or requests are full. Refresh and try again.";
  }
  return error instanceof Error
    ? error.message
    : "We couldn't complete that action. Please try again.";
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
      `Use ${required ? "1–" : "up to "}${max} different comma-separated values, up to ${itemLength} characters each.`,
    );
  return values;
}
export const ageBands = ["18-20", "21-24", "25-29", "30-39", "40+"];
export const privacyModes: PrivacyMode[] = ["OPEN", "PRIVATE", "INCOGNITO"];
