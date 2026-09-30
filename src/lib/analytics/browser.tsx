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
  | "invite_link_copied";
export function useAnalytics() {
  const enabled = useContext(AnalyticsEnabled);
  return useCallback(
    (name: BrowserEvent) => {
      if (enabled)
        void requestApi("/api/analytics", "POST", {
          name,
          surface:
            name === "landing_view"
              ? "landing"
              : name === "intent_started"
                ? "create"
                : "invite",
        }).catch(() => {});
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
