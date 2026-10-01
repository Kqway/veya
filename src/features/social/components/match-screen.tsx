"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  socialApi,
  useSocialAction,
  type Match,
  type Message,
} from "../client";
import { Person, SocialError, SocialShell } from "./common";
import { SafetyControls } from "./safety-controls";
type MessagePage = { messages: Message[]; nextBefore: string | null };
export function MatchScreen({ matchKey }: { matchKey: string }) {
  const [match, setMatch] = useState<Match | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [nextBefore, setNextBefore] = useState<string | null>(null),
    [text, setText] = useState(""),
    [kind, setKind] = useState<"first_name" | "contact_handle">("first_name"),
    [value, setValue] = useState(""),
    [consent, setConsent] = useState(false),
    [planConfirm, setPlanConfirm] = useState(false),
    [notice, setNotice] = useState("");
  const action = useSocialAction();
  const { run } = action;
  const path = `/matches/${encodeURIComponent(matchKey)}`;
  useEffect(() => {
    void run(async (alive) => {
      const data = await socialApi<Match>(path);
      if (!alive()) return;
      setMatch(data);
      const page = await socialApi<MessagePage>(`${path}/messages?limit=30`);
      if (alive()) {
        setMessages(page.messages);
        setNextBefore(page.nextBefore);
      }
    });
  }, [path, run]);
  function refresh() {
    void run(async (alive) => {
      const data = await socialApi<Match>(path);
      if (!alive()) return;
      setMatch(data);
      const page = await socialApi<MessagePage>(`${path}/messages?limit=30`);
      if (alive()) {
        setMessages(page.messages);
        setNextBefore(page.nextBefore);
      }
    });
  }
  function send(e: FormEvent) {
    e.preventDefault();
    void run(async (alive) => {
      if (!text.trim() || text.trim().length > 2000)
        throw new Error("Write a message from 1 to 2000 characters.");
      const data = await socialApi<Message>(`${path}/messages`, "POST", {
        text: text.trim(),
      });
      if (alive()) {
        setMessages((values) => [...values, data].slice(-300));
        setText("");
        setNotice("Message sent.");
      }
    });
  }
  function disclose(e: FormEvent) {
    e.preventDefault();
    void run(async (alive) => {
      if (!consent)
        throw new Error("Confirm your consent before sharing a detail.");
      if (
        !value.trim() ||
        value.trim().length > (kind === "first_name" ? 60 : 120)
      )
        throw new Error(
          `Use up to ${kind === "first_name" ? 60 : 120} characters for this disclosure.`,
        );
      await socialApi(`${path}/disclosures`, "POST", {
        kind,
        value: value.trim(),
        consent: true,
      });
      if (alive()) {
        setMatch((current) =>
          current
            ? {
                ...current,
                disclosures: [
                  ...current.disclosures.filter(
                    (d) => !(d.isMine && d.kind === kind),
                  ),
                  { kind, value: value.trim(), isMine: true },
                ],
              }
            : current,
        );
        setValue("");
        setConsent(false);
        setNotice("Detail shared in this match.");
      }
    });
  }
  const closed = match?.status === "closed";
  return (
    <SocialShell title="Your conversation">
      <SocialError message={action.error} focusRef={action.errorRef} />
      {!match && !action.error && (
        <p role="status">Loading your conversation…</p>
      )}
      {match && (
        <>
          <section className="social-card">
            <Person identity={match.identity} />
            <h2>{match.activityLabel}</h2>
            <p>You appear here as {match.ownIdentity.alias}.</p>
            <p className="quiet-copy">
              This alias belongs to your pair context. There are no public
              profile links.
            </p>
            {closed && (
              <p className="social-warning" role="status">
                This conversation is closed. You can read its history.
              </p>
            )}
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={refresh}
            >
              Refresh messages
            </button>
            <h3>Messages</h3>
            {messages.length === 0 && (
              <p>
                No messages yet. Start with the activity you have in common.
              </p>
            )}
            {nextBefore && (
              <button
                className="button button-secondary"
                disabled={action.busy || messages.length >= 300}
                onClick={() => {
                  void run(async (alive) => {
                    const page = await socialApi<MessagePage>(
                      `${path}/messages?before=${encodeURIComponent(nextBefore)}&limit=30`,
                    );
                    if (alive()) {
                      setMessages((values) => {
                        const known = new Set(values.map((m) => m.publicKey));
                        return [
                          ...page.messages.filter(
                            (m) => !known.has(m.publicKey),
                          ),
                          ...values,
                        ].slice(0, 300);
                      });
                      setNextBefore(page.nextBefore);
                    }
                  });
                }}
              >
                Load older
              </button>
            )}
            {messages.length >= 300 && nextBefore && (
              <p>
                Showing up to 300 messages. Refresh to return to the latest
                conversation.
              </p>
            )}
            <ol className="social-messages" aria-label="Conversation messages">
              {messages.map((message) => (
                <li
                  key={message.publicKey}
                  className={
                    message.isMine
                      ? "social-message social-message-mine"
                      : "social-message"
                  }
                >
                  <strong>
                    {message.isMine ? "You" : message.identity.alias}
                  </strong>
                  <p className="social-plain">{message.text}</p>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
            {!closed && (
              <form onSubmit={send} noValidate>
                <fieldset disabled={action.busy}>
                  <label className="field">
                    Message
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                  <p className="quiet-copy">Plain text · {text.length}/2000</p>
                  <button className="button button-primary">
                    Send message
                  </button>
                </fieldset>
              </form>
            )}
          </section>
          <section className="social-card">
            <h2>Details shared in this match</h2>
            <p>
              Details are shared only with this person. Information already seen
              cannot be taken back.
            </p>
            {match.disclosures.length === 0 && (
              <p>No personal details shared.</p>
            )}
            <ul>
              {match.disclosures.map((d, index) => (
                <li
                  key={`${d.kind}-${d.isMine}-${index}`}
                  className="social-plain"
                >
                  {d.isMine ? "You" : match.identity.alias} ·{" "}
                  {d.kind === "first_name" ? "First name" : "Contact handle"}:{" "}
                  {d.value}
                </li>
              ))}
            </ul>
            {!closed && (
              <form onSubmit={disclose} noValidate>
                <fieldset disabled={action.busy}>
                  <label className="field">
                    Detail to share
                    <select
                      value={kind}
                      onChange={(e) => {
                        setKind(e.target.value as typeof kind);
                        setConsent(false);
                        setValue("");
                      }}
                    >
                      <option value="first_name">First name</option>
                      <option value="contact_handle">Contact handle</option>
                    </select>
                  </label>
                  <label className="field">
                    Disclosure value
                    <input
                      autoComplete="off"
                      maxLength={kind === "first_name" ? 60 : 120}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </label>
                  <p className="social-warning">
                    Sharing is a deliberate disclosure. You cannot undo what
                    this person has already seen. Share only what you are
                    comfortable revealing.
                  </p>
                  <label className="social-check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    I understand and consent
                  </label>
                  <button
                    className="button button-secondary"
                    disabled={match.disclosures.some(
                      (d) => d.isMine && d.kind === kind,
                    )}
                  >
                    Share disclosure
                  </button>
                </fieldset>
              </form>
            )}
          </section>
          {!closed && (
            <section className="social-card">
              <h2>Turn the conversation into a plan</h2>
              <p>
                A Veya plan has a bearer invitation link: anyone with the link
                can access the plan. Blocking social contact cannot retract a
                copied link. Your private availability and disclosures are not
                copied; add availability separately.
              </p>
              {match.planSlug ? (
                <Link
                  className="button button-primary"
                  href={`/i/${encodeURIComponent(match.planSlug)}`}
                >
                  Open plan
                </Link>
              ) : (
                <>
                  <button
                    className="button button-primary"
                    disabled={action.busy}
                    onClick={() => setPlanConfirm(true)}
                  >
                    Plan it
                  </button>
                  {planConfirm && (
                    <div className="social-warning">
                      <p>
                        Create an invitation that either of you can share with
                        other people?
                      </p>
                      <div className="social-actions">
                        <button
                          className="button button-secondary"
                          disabled={action.busy}
                          onClick={() => {
                            void run(async (alive) => {
                              const data = await socialApi<{
                                publicSlug: string;
                              }>(`${path}/plan`, "POST", {});
                              if (alive()) {
                                setMatch({
                                  ...match,
                                  planSlug: data.publicSlug,
                                });
                                setPlanConfirm(false);
                                setNotice(
                                  "Plan created. Open it to add your availability.",
                                );
                              }
                            });
                          }}
                        >
                          Create plan
                        </button>
                        <button
                          className="social-text-button"
                          onClick={() => setPlanConfirm(false)}
                        >
                          Cancel plan
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          <section className="social-card">
            <h2>Safety</h2>
            <SafetyControls
              target={{ matchKey }}
              onBlocked={() =>
                setMatch({ ...match, status: "closed", planSlug: null })
              }
            />
          </section>
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </SocialShell>
  );
}
