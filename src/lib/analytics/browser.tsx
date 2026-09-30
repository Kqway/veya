"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { requestApi } from "@/features/entry/client";
const AnalyticsEnabled = createContext(false);
export function AnalyticsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <AnalyticsEnabled.Provider value={enabled}>
      {children}
    </AnalyticsEnabled.Provider>
  );
}
type BrowserEvent =
  | "landing_view"
  | "intent_started"
  | "invite_opened"
  | "invite_link_copied"
  | "result_viewed"
  | "new_intent_from_invite";
export function useAnalytics() {
  const enabled = useContext(AnalyticsEnabled);
  return useCallback(
    (name: BrowserEvent, source?: "invite" | "result") => {
      if (enabled)
        void requestApi(
          "/api/analytics",
          "POST",
          {
            name,
            surface:
              name === "new_intent_from_invite"
                ? (source ?? "invite")
                : name === "result_viewed"
                  ? "result"
                  : name === "landing_view"
                    ? "landing"
                    : name === "intent_started"
                      ? "create"
                      : "invite",
          },
          { keepalive: true },
        ).catch(() => {});
    },
    [enabled],
  );
}
export function usePageEvent(name: "landing_view" | "invite_opened") {
  const track = useAnalytics(),
    tracked = useRef(false);
  useEffect(() => {
    if (!tracked.current) {
      tracked.current = true;
      track(name);
    }
  }, [track, name]);
}
