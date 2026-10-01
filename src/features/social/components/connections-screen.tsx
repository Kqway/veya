"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { socialApi, useSocialAction, type Connection } from "../client";
import { Person, SocialError, SocialShell } from "./common";
import { SafetyControls } from "./safety-controls";
export function ConnectionsScreen() {
  const [requests, setRequests] = useState<Connection[] | null>(null);
  const action = useSocialAction();
  const { run } = action;
  useEffect(() => {
    void run(async (alive) => {
      const data = await socialApi<{ requests: Connection[] }>("/connections");
      if (alive()) setRequests(data.requests);
    });
  }, [run]);
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
      <SocialError message={action.error} focusRef={action.errorRef} />
      <button
        className="button button-secondary"
        disabled={action.busy}
        onClick={() => {
          void run(async (alive) => {
            const data = await socialApi<{ requests: Connection[] }>(
              "/connections",
            );
            if (alive()) setRequests(data.requests);
          });
        }}
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
                  onBlocked={() =>
                    setRequests(
                      (values) =>
                        values?.filter(
                          (r) => r.publicKey !== request.publicKey,
                        ) ?? [],
                    )
                  }
                />
              </article>
            ))}
        </section>
      ))}
    </SocialShell>
  );
}
