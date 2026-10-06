"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, requestApi } from "@/features/entry/client";
import { socialApi, socialError, type Profile } from "@/features/social/client";
import { useSocialRefresh } from "@/features/realtime/client";
import { SocialLiveStatus } from "@/features/social/components/common";

export const productApi = <T,>(path: string, method = "GET", body?: unknown) => requestApi<T>(`/api/intavro${path}`, method, body);
export function ProductShell({ children, title, eyebrow = "Veya / вместе" }: { children: ReactNode; title: string; eyebrow?: string }) {
  return <section className="intent-product"><div className="intent-heading"><p className="intent-eyebrow">{eyebrow}</p><h1>{title}</h1></div>{children}</section>;
}
export function ProductError({ message, retry }: { message: string | null; retry?: (() => Promise<void>) | undefined }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [message]);
  return message ? <div><p className="intent-error" role="alert" tabIndex={-1} ref={ref}>{message}</p>{retry && <button className="intent-text-button" type="button" onClick={() => { void retry(); }}>Попробовать снова</button>}</div> : null;
}
export function ProductUnavailable({ restricted }: { restricted: boolean }) {
  return <div className="intent-empty"><h2>{restricted ? "Профиль недоступен" : "Начните со своего намерения"}</h2><p>{restricted ? "Действия в этой сессии ограничены. Настройки профиля и его удаление доступны в разделе «Я»." : "Для предложений и временных комнат нужен профиль Veya."}</p><Link href={restricted ? "/profile" : "/network"}>{restricted ? "Открыть мой профиль" : "На экран «Сейчас»"}</Link></div>;
}
/** Text and keys stay in memory. Live reads never replace an unsaved local edit. */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const ownUrl = new URL(window.location.href);
    const ownHistoryState = window.history.state;
    const confirmDiscard = () => window.confirm("Остались несохранённые изменения. Уйти со страницы?");
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const link = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const element = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(element instanceof HTMLAnchorElement) || (element.target && element.target !== "_self") || element.hasAttribute("download")) return;
      const target = new URL(element.href, window.location.href);
      if (!["http:", "https:"].includes(target.protocol) || (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search)) return;
      if (!confirmDiscard()) { event.preventDefault(); event.stopImmediatePropagation(); }
      else window.removeEventListener("beforeunload", beforeUnload);
    };
    const history = (event: Event) => {
      if (window.location.pathname === ownUrl.pathname && window.location.search === ownUrl.search) return;
      if (!confirmDiscard()) { event.preventDefault(); window.history.pushState(ownHistoryState, "", ownUrl.href); }
      else window.removeEventListener("beforeunload", beforeUnload);
    };
    window.addEventListener("beforeunload", beforeUnload); document.addEventListener("click", link, true); window.addEventListener("intavro:before-history-navigation", history, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", link, true); window.removeEventListener("intavro:before-history-navigation", history, true); };
  }, [dirty]);
}
export function useProductData<T>(read: () => Promise<T>, initial: T) {
  const initialRef = useRef(initial);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const readRef = useRef(read);
  useEffect(() => { readRef.current = read; }, [read]);
  const refresh = useCallback(async () => {
    const turn = ++generation.current;
    try {
      const result = await socialApi<{ profile: Profile | null }>("/profile");
      if (turn !== generation.current) return;
      setProfile(result.profile); setRestricted(false);
      if (!result.profile) setData(initialRef.current);
      if (result.profile) {
        const next = await readRef.current();
        if (turn !== generation.current) return;
        setData(next);
      }
      setError(null);
    } catch (cause) {
      if (turn !== generation.current) return;
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        setProfile(null); setData(initialRef.current); setRestricted(cause.status === 403); setError(null);
      } else { if (cause instanceof ApiError && cause.status === 404) setData(initialRef.current); setError(socialError(cause)); }
    } finally { if (turn === generation.current) setLoaded(true); }
  }, []);
  useEffect(() => {
    let active = true;
    const currentGeneration = generation;
    queueMicrotask(() => { if (active) void refresh(); });
    const changed = () => { setLoaded(false); void refresh(); };
    window.addEventListener("veya:social-profile-changed", changed);
    return () => { active = false; ++currentGeneration.current; window.removeEventListener("veya:social-profile-changed", changed); };
  }, [refresh]);
  const live = useSocialRefresh(["intents", "rooms", "notifications"], refresh, { enabled: !!profile && loaded });
  return { profile, data, setData, loaded, restricted, error, refresh, live };
}
export function ProductRefresh({ refresh, live }: { refresh: () => Promise<void>; live: ReturnType<typeof useSocialRefresh> }) {
  const [refreshing, setRefreshing] = useState(false);
  return <div className="intent-refresh"><SocialLiveStatus {...live} /><button type="button" className="intent-text-button" disabled={refreshing} onClick={() => { setRefreshing(true); void refresh().finally(() => setRefreshing(false)); }}>{refreshing ? "Обновляем…" : "Обновить"}</button></div>;
}
