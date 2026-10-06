"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, requestApi } from "@/features/entry/client";
import { useSocialRefresh } from "@/features/realtime/client";

export const agentApi = <T,>(path: string, method = "GET", body?: unknown) =>
  requestApi<T>(`/api/agent${path}`, method, body);
export function goalError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Сеанс завершён. Восстановите профиль, чтобы продолжить.";
    if (error.status === 403)
      return "Профиль сейчас недоступен. Откройте настройки профиля.";
    if (error.status === 404) return "Эта цель недоступна в вашем профиле.";
    if (error.status === 409)
      return "Состояние изменилось. Обновите цель и попробуйте снова.";
    if (error.status === 429)
      return "Немного подождите. Ваш текст остался здесь.";
    if (error.status === 400)
      return "Проверьте текст цели и сумму. Например: «Заработать 10 000 ₽».";
  }
  return "Не удалось связаться с Veya. Попробуйте ещё раз.";
}

/** Persistent reads are authoritative; stale responses cannot cross profile/route boundaries. */
export function useGoalResource<T>(
  path: string,
  { allowUnbound = false }: { allowUnbound?: boolean } = {},
) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null),
    [unbound, setUnbound] = useState(false);
  const state = useRef({ mounted: false, generation: 0 });
  const reload = useCallback(async () => {
    const generation = ++state.current.generation;
    const current = () =>
      state.current.mounted && generation === state.current.generation;
    try {
      const result = await agentApi<T>(path);
      if (current()) {
        setData(result);
        setError(null);
        setUnbound(false);
      }
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && [401, 403, 404].includes(cause.status))
        setData(null);
      if (
        allowUnbound &&
        cause instanceof ApiError &&
        [401, 404].includes(cause.status)
      ) {
        setData(null);
        setUnbound(true);
        setError(null);
      } else setError(goalError(cause));
    } finally {
      if (current()) setLoading(false);
    }
  }, [path, allowUnbound]);
  useEffect(() => {
    const own = state.current;
    own.mounted = true;
    const changed = () => {
      ++state.current.generation;
      setData(null);
      setLoading(true);
      setError(null);
      void reload();
    };
    const focus = () => {
      void reload();
    };
    void Promise.resolve().then(reload);
    window.addEventListener("veya:social-profile-changed", changed);
    window.addEventListener("focus", focus);
    return () => {
      own.mounted = false;
      ++own.generation;
      window.removeEventListener("veya:social-profile-changed", changed);
      window.removeEventListener("focus", focus);
    };
  }, [reload]);
  const live = useSocialRefresh("goals", reload, {
    enabled: !!data && !unbound,
  });
  return { data, loading, error, unbound, reload, live };
}

export function useGoalAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const state = useRef({ mounted: false, running: false, generation: 0 });
  useEffect(() => {
    const own = state.current;
    own.mounted = true;
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === own) return;
      ++own.generation;
      setError(null);
    };
    window.addEventListener("veya:social-profile-changed", changed);
    return () => {
      own.mounted = false;
      ++own.generation;
      window.removeEventListener("veya:social-profile-changed", changed);
    };
  }, []);
  const run = async (work: (current: () => boolean) => Promise<void>) => {
    if (state.current.running) return;
    const generation = ++state.current.generation;
    const current = () =>
      state.current.mounted && generation === state.current.generation;
    state.current.running = true;
    setBusy(true);
    setError(null);
    try {
      await work(current);
    } catch (cause) {
      if (current()) setError(goalError(cause));
    } finally {
      state.current.running = false;
      if (state.current.mounted) setBusy(false);
    }
  };
  const profileCommitted = () =>
    window.dispatchEvent(
      new CustomEvent("veya:social-profile-changed", { detail: state.current }),
    );
  return { busy, error, run, profileCommitted };
}
