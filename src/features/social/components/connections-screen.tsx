"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSocialRefresh } from "@/features/realtime/client";
import { socialApi, useSocialAction, type Connection } from "../client";
import { Person, SocialError, SocialShell, SocialLiveStatus } from "./common";
import { SafetyControls } from "./safety-controls";
export function ConnectionsScreen() {
  const [requests, setRequests] = useState<Connection[] | null>(null);
  const action = useSocialAction();
  const { run: runAction } = action;
  const { run: runBackground } = useSocialAction();
  const generation = useRef(0);
  const run = useCallback((work: (current: () => boolean) => Promise<void>) =>
    runAction(async (alive) => {
      const version = ++generation.current;
      const current = () => alive() && version === generation.current;
      try { await work(current); }
      catch (error) { if (current()) throw error; }
    }), [runAction]);
  const readRequests = useCallback(async (alive: () => boolean) => {
    const version = generation.current;
    const data = await socialApi<{ requests: Connection[] }>("/connections");
    if (alive() && version === generation.current) setRequests(data.requests);
  }, []);
  const reload = useCallback(() => run(readRequests), [run, readRequests]);
  const reloadLive = useCallback(() => runBackground(readRequests), [runBackground, readRequests]);
  useEffect(() => { void reload(); }, [reload]);
  const live = useSocialRefresh(["connections", "match"], reloadLive, { enabled: !action.busy });
  function respond(key: string, response: "accept" | "decline") {
    void run(async (alive) => {
      const data = await socialApi<{
        publicKey: string;
        status: Connection["status"];
        matchKey: string | null;
      }>(`/connections/${encodeURIComponent(key)}/respond`, "POST", {
        action: response,
      });
      if (alive())
        setRequests(
          (values) =>
            values?.map((r) => (r.publicKey === key ? { ...r, ...data } : r)) ??
            [],
        );
    });
  }
  return (
    <SocialShell title="Connections">
      <p>Interested is a request to connect. Accepting opens a private conversation; nothing personal is shared automatically.</p>
      <SocialError message={action.error} focusRef={action.errorRef} />
      <SocialLiveStatus {...live} />
      <button
        className="button button-secondary"
        disabled={action.busy}
        onClick={() => { void reload(); }}
      >
        Refresh connections
      </button>
      {requests === null && !action.error && (
        <p role="status">Loading connections…</p>
      )}
      {requests?.length === 0 && (
        <p className="social-card">
          No connections yet.{" "}
          <Link href="/discover">Find people through an activity.</Link>
        </p>
      )}
      {(["incoming", "outgoing"] as const).map((direction) => (
        <section
          key={direction}
          aria-label={
            direction === "incoming" ? "Incoming requests" : "Outgoing requests"
          }
        >
          <h2>
            {direction === "incoming"
              ? "Incoming requests"
              : "Outgoing requests"}
          </h2>
          {requests
            ?.filter((r) => r.direction === direction)
            .map((request) => (
              <article key={request.publicKey} className="social-card">
                <Person identity={request.identity} />
                <h3>{request.activityLabel}</h3>
                <p>Status: {request.status}</p>
                {request.status === "pending" && <p>{request.direction === "outgoing" ? "Waiting for the recipient to accept. Chat opens after acceptance." : "Accept to chat about this activity, or decline the request."}</p>}
                {request.status === "expired" && <p>The activity closed, expired or no longer shares future availability. This is not a decline.</p>}
                {request.direction === "incoming" &&
                  request.status === "pending" && (
                    <div className="social-actions">
                      <button
                        disabled={action.busy}
                        className="button button-primary"
                        onClick={() => respond(request.publicKey, "accept")}
                      >
                        Accept
                      </button>
                      <button
                        disabled={action.busy}
                        className="button button-secondary"
                        onClick={() => respond(request.publicKey, "decline")}
                      >
                        Decline
                      </button>
                    </div>
                  )}
                {request.matchKey && (
                  <Link
                    className="button button-primary"
                    href={`/m/${encodeURIComponent(request.matchKey)}`}
                  >
                    View conversation
                  </Link>
                )}
                <SafetyControls
                  target={{ requestKey: request.publicKey }}
                  onBlocked={() => {
                    ++generation.current;
                    setRequests(
                      (values) =>
                        values?.filter(
                          (r) => r.publicKey !== request.publicKey,
                        ) ?? [],
                    );
                  }}
                />
              </article>
            ))}
        </section>
      ))}
    </SocialShell>
  );
}
