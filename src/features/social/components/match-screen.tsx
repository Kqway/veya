"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSocialRefresh } from "@/features/realtime/client";
import {
  socialApi,
  useSocialAction,
  type Match,
  type Message,
} from "../client";
import { Person, SocialError, SocialShell, SocialLiveStatus } from "./common";
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
  const path = `/matches/${encodeURIComponent(matchKey)}`;
  const olderLoaded = useRef(false);
  const latestLoadedKeys = useRef(new Set<string>());
  useEffect(() => {
    olderLoaded.current = false;
    void run(async (alive) => {
      const data = await socialApi<Match>(path);
      if (!alive()) return;
      setMatch(data);
      const page = await socialApi<MessagePage>(`${path}/messages?limit=30`);
      if (alive()) {
        latestLoadedKeys.current=new Set(page.messages.map(message=>message.publicKey));
        setMessages(page.messages);
        setNextBefore(page.nextBefore);
      }
    });
  }, [path, run]);
  const readLatest = useCallback(async (alive: () => boolean) => {
    const version = generation.current;
    const data = await socialApi<Match>(path);
    if (!alive() || version !== generation.current) return;
    setMatch(data);
    const page = await socialApi<MessagePage>(`${path}/messages?limit=30`);
    if (alive() && version === generation.current) {
      const contiguous=page.messages.some(message=>latestLoadedKeys.current.has(message.publicKey)) || latestLoadedKeys.current.size===0;
      latestLoadedKeys.current=new Set(page.messages.map(message=>message.publicKey));
      if(!contiguous){
        olderLoaded.current=false;
        setMessages(page.messages);
        setNextBefore(page.nextBefore);
        setNotice("Пока вас не было, появились новые сообщения. Нажмите «Загрузить предыдущие», чтобы прочитать более ранние сообщения.");
      }else{
        setMessages((values) => mergeMessages(values, page.messages));
        if (!olderLoaded.current) setNextBefore(page.nextBefore);
      }
    }
  }, [path]);
  const reload = useCallback(() => run(readLatest), [run, readLatest]);
  const reloadLive = useCallback(() => runBackground(readLatest), [runBackground, readLatest]);
  const live = useSocialRefresh(["match", "connections"], reloadLive, { enabled: !!match && !action.busy });
  function refresh() { void reload(); }
  function send(e: FormEvent) {
    e.preventDefault();
    void run(async (alive) => {
      if (!text.trim() || text.trim().length > 2000)
        throw new Error("Напишите сообщение длиной от 1 до 2000 символов.");
      const data = await socialApi<Message>(`${path}/messages`, "POST", {
        text: text.trim(),
      });
      if (alive()) {
        setMessages((values) => mergeMessages(values, [data]));
        setText("");
        setNotice("Сообщение отправлено.");
      }
    });
  }
  function disclose(e: FormEvent) {
    e.preventDefault();
    void run(async (alive) => {
      if (!consent)
        throw new Error("Подтвердите согласие, прежде чем поделиться сведениями.");
      if (
        !value.trim() ||
        value.trim().length > (kind === "first_name" ? 60 : 120)
      )
        throw new Error(
          `Используйте не более ${kind === "first_name" ? 60 : 120} символов для этих сведений.`,
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
        setNotice("Сведения переданы собеседнику.");
      }
    });
  }
  const closed = match?.status === "closed";
  return (
    <SocialShell title="Ваш чат">
      <SocialError message={action.error} focusRef={action.errorRef} />
      <SocialLiveStatus {...live} />
      {!match && !action.error && (
        <p role="status">Загружаем ваш чат…</p>
      )}
      {match && (
        <>
          <section className="social-card">
            <Person identity={match.identity} />
            <h2>{match.activityLabel}</h2>
            <p>Ваш псевдоним здесь — {match.ownIdentity.alias}.</p>
            <p className="quiet-copy">
              Этот псевдоним используется только в вашей паре. Общедоступных ссылок на профиль нет. Делиться именем или контактами необязательно.
            </p>
            {closed && (
              <p className="social-warning" role="status">
                Этот чат закрыт. Вы можете читать историю сообщений.
              </p>
            )}
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={refresh}
            >
              Обновить сообщения
            </button>
            <h3>Сообщения</h3>
            {messages.length === 0 && (
              <p>
                Сообщений пока нет. Начните с общего занятия.
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
                      olderLoaded.current = true;
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
                Загрузить предыдущие
              </button>
            )}
            {messages.length >= 300 && nextBefore && (
              <p>
                Показана загруженная история чата. Новые сообщения продолжат появляться здесь.
              </p>
            )}
            <ol className="social-messages" aria-label="Сообщения чата">
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
                    {message.isMine ? "Вы" : message.identity.alias}
                  </strong>
                  <p className="social-plain">{message.text}</p>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleString("ru-RU")}
                  </time>
                </li>
              ))}
            </ol>
            {!closed && (
              <form onSubmit={send} noValidate>
                <fieldset disabled={action.busy}>
                  <label className="field">
                    Сообщение
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                  <p className="quiet-copy">Обычный текст · {text.length}/2000</p>
                  <button className="button button-primary">
                    Отправить сообщение
                  </button>
                </fieldset>
              </form>
            )}
          </section>
          <section className="social-card">
            <h2>Сведения, которыми вы поделились</h2>
            <p>
              Сведения видит только ваш собеседник. То, что он уже увидел, нельзя отозвать.
            </p>
            {match.disclosures.length === 0 && (
              <p>Личные сведения ещё не переданы.</p>
            )}
            <ul>
              {match.disclosures.map((d, index) => (
                <li
                  key={`${d.kind}-${d.isMine}-${index}`}
                  className="social-plain"
                >
                  {d.isMine ? "Вы" : match.identity.alias} ·{" "}
                  {d.kind === "first_name" ? "Имя" : "Контакт для связи"}:{" "}
                  {d.value}
                </li>
              ))}
            </ul>
            {!closed && (
              <form onSubmit={disclose} noValidate>
                <fieldset disabled={action.busy}>
                  <label className="field">
                    Чем поделиться
                    <select
                      value={kind}
                      onChange={(e) => {
                        setKind(e.target.value as typeof kind);
                        setConsent(false);
                        setValue("");
                      }}
                    >
                      <option value="first_name">Имя</option>
                      <option value="contact_handle">Контакт для связи</option>
                    </select>
                  </label>
                  <label className="field">
                    Сведения для передачи
                    <input
                      autoComplete="off"
                      maxLength={kind === "first_name" ? 60 : 120}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </label>
                  <p className="social-warning">
                    Вы сами решаете раскрыть эти сведения. То, что собеседник уже увидел, нельзя отозвать. Делитесь только тем, что готовы сообщить.
                  </p>
                  <label className="social-check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    Я понимаю и даю согласие
                  </label>
                  <button
                    className="button button-secondary"
                    disabled={match.disclosures.some(
                      (d) => d.isMine && d.kind === kind,
                    )}
                  >
                    Поделиться сведениями
                  </button>
                </fieldset>
              </form>
            )}
          </section>
          {!closed && (
            <section className="social-card">
              <h2>Договоритесь о встрече</h2>
              <p>
                У плана Intavro есть ссылка-приглашение: любой, у кого она есть, может открыть план. Блокировка собеседника не отменяет доступ по скопированной ссылке. Ваше личное расписание и переданные сведения не копируются — добавьте свободное время отдельно. Присоединитесь к плану оба, выберите время и проголосуйте за предложения. Организатор подтвердит итоговое время встречи.
              </p>
              {match.planSlug ? (
                <Link
                  className="button button-primary"
                  href={`/i/${encodeURIComponent(match.planSlug)}`}
                >
                  Открыть план
                </Link>
              ) : (
                <>
                  <button
                    className="button button-primary"
                    disabled={action.busy}
                    onClick={() => setPlanConfirm(true)}
                  >
                    Организовать встречу
                  </button>
                  {planConfirm && (
                    <div className="social-warning">
                      <p>
                        Создать приглашение, которым каждый из вас сможет поделиться с другими людьми?
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
                                  "План создан. Откройте его, чтобы добавить свободное время.",
                                );
                              }
                            });
                          }}
                        >
                          Создать план
                        </button>
                        <button
                          className="social-text-button"
                          onClick={() => setPlanConfirm(false)}
                        >
                          Отменить создание плана
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          <section className="social-card">
            <h2>Безопасность</h2>
            <SafetyControls
              target={{ matchKey }}
              onBlocked={() => {
                ++generation.current;
                setMatch({ ...match, status: "closed", planSlug: null });
              }}
            />
          </section>
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </SocialShell>
  );
}

function mergeMessages(previous: Message[], incoming: Message[]): Message[] {
  const known = new Map(previous.map((message) => [message.publicKey, message]));
  for (const message of incoming) known.set(message.publicKey, message);
  return [...known.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.publicKey.localeCompare(b.publicKey));
}
