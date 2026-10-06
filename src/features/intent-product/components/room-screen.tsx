"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useSocialAction } from "@/features/social/client";
import { Person } from "@/features/social/components/common";
import type { RoomDTO, RoomMessageDTO } from "../schema";
import { ProductError, ProductRefresh, ProductShell, ProductUnavailable, productApi, useProductData, useUnsavedGuard } from "./product-common";
const statuses = { forming: "Компания собирается", ready: "Компания собралась", active: "В процессе", completed: "Дело завершено", archived: "Комната в архиве", closed: "Общение закрыто" };
type RoomData = { room: RoomDTO; messages: RoomMessageDTO[]; nextBefore: string | null };
type SafetyAction = { kind: "report" | "block" | "remove"; member: RoomDTO["members"][number] };
export function RoomScreen({ roomKey }: { roomKey: string }) {
  const base = `/rooms/${encodeURIComponent(roomKey)}`;
  const state = useProductData(async () => {
    const [room, messages] = await Promise.all([productApi<{ room: RoomDTO }>(base), productApi<{ messages: RoomMessageDTO[]; nextBefore: string | null }>(`${base}/messages?limit=50`)]);
    return { ...room, ...messages };
  }, null as RoomData | null);
  const [text, setText] = useState("");
  const [earlier, setEarlier] = useState<RoomMessageDTO[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [safety, setSafety] = useState<SafetyAction | null>(null);
  const [reason, setReason] = useState("spam");
  const [details, setDetails] = useState("");
  const [complete, setComplete] = useState(false);
  const [leave, setLeave] = useState(false);
  const router = useRouter();
  const action = useSocialAction();
  useUnsavedGuard(!!text.trim() || !!details.trim());
  const room = state.data?.room;
  const writable = !!room && ["ready", "active"].includes(room.status);
  const messages = [...new Map([...earlier, ...(state.data?.messages ?? [])].map((message) => [message.publicKey, message])).values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const nextBefore = olderCursor === undefined ? state.data?.nextBefore : olderCursor;
  function send(event: FormEvent) {
    event.preventDefault();
    void action.run(async (alive) => {
      if (!text.trim()) throw new Error("Напишите сообщение.");
      await productApi(`${base}/messages`, "POST", { text: text.trim() });
      if (alive()) { setText(""); await state.refresh(); }
    });
  }
  function transition(status: "active" | "completed" | "archived") {
    void action.run(async (alive) => {
      await productApi(`${base}/state`, "POST", { status });
      if (alive()) { setComplete(false); setNotice(status === "completed" ? "Вы отметили дело завершённым." : status === "archived" ? "Комната перенесена в архив." : "Можно начинать."); await state.refresh(); }
    });
  }
  function removeSelf() {
    const member = room?.members.find((item) => item.isMine);
    if (!member) return;
    void action.run(async (alive) => {
      await productApi(`${base}/remove`, "POST", { memberKey: member.publicKey });
      if (alive()) { setText(""); setLeave(false); router.push("/people"); }
    });
  }
  function safetySubmit(event?: FormEvent) {
    event?.preventDefault();
    if (!safety) return;
    void action.run(async (alive) => {
      await productApi(`${base}/${safety.kind}`, "POST", { memberKey: safety.member.publicKey, ...(safety.kind === "report" ? { reason, ...(details.trim() ? { text: details.trim() } : {}) } : {}) });
      if (alive()) { setSafety(null); setDetails(""); setNotice(safety.kind === "report" ? "Жалоба получена." : "Общение закрыто."); await state.refresh(); }
    });
  }
  return <ProductShell title={room?.activityLabel ?? "Временная комната"} eyebrow="Veya / вместе"><ProductError message={action.error ?? state.error} retry={state.error ? state.refresh : undefined} />{!state.loaded && <p role="status">Открываем комнату…</p>}{state.loaded && !state.profile && !state.error && <ProductUnavailable restricted={state.restricted} />}{notice && <p role="status" className="intent-notice">{notice}</p>}{state.profile && room && <>
    <section className="intent-card intent-room-overview"><div className="intent-card-heading"><h2>{statuses[room.status]}</h2><span className="intent-state">{room.joinedCount} / {room.capacity}</span></div><p className="intent-muted">Комната только для этого дела. Здесь обычная переписка; помощник её не читает.</p>{room.externalCount > 0 && <p className="intent-muted">Организатор указал ещё {room.externalCount} участников вне Veya. Их аккаунтов в этой комнате нет.</p>}<ul className="intent-members" aria-label="Участники комнаты">{room.members.map((member) => <li key={member.publicKey}><Person identity={member} />{member.isMine ? <span className="intent-muted">Вы</span> : <div className="intent-member-actions"><button className="intent-text-button" disabled={action.busy} onClick={() => { setSafety({ kind: "report", member }); setDetails(""); }}>Пожаловаться на {member.alias}</button><button className="intent-text-button" disabled={action.busy} onClick={() => setSafety({ kind: "block", member })}>Заблокировать {member.alias}</button>{room.isOwner && writable && <button className="intent-text-button" disabled={action.busy} onClick={() => setSafety({ kind: "remove", member })}>Удалить {member.alias} из комнаты</button>}</div>}</li>)}</ul>
      {room.isOwner && <div className="intent-actions">{room.status === "ready" && <button className="intent-button" disabled={action.busy} onClick={() => transition("active")}>Начать дело</button>}{writable && <button className="intent-text-button" disabled={action.busy} onClick={() => setComplete(true)}>Завершить дело</button>}{room.status === "completed" && <button className="intent-text-button" disabled={action.busy} onClick={() => transition("archived")}>В архив</button>}</div>}
      {complete && <div className="intent-confirm"><p>Отметить дело завершённым? Комната уйдёт из активного списка. Это ваша отметка, а не подтверждение реальной встречи.</p><button className="intent-button" disabled={action.busy} onClick={() => transition("completed")}>Подтвердить завершение</button><button className="intent-text-button" onClick={() => setComplete(false)}>Отмена</button></div>}
      {writable && <div className="intent-actions">{room.planSlug ? <Link className="intent-text-button" href={`/i/${encodeURIComponent(room.planSlug)}`}>Открыть план встречи</Link> : <button className="intent-text-button" disabled={action.busy} onClick={() => { void action.run(async (alive) => { if (text.trim() && !window.confirm("Осталось неотправленное сообщение. Перейти к плану встречи?")) return; const plan = await productApi<{ slug: string }>(`${base}/plan`, "POST", {}); if (alive()) { setText(""); router.push(`/i/${encodeURIComponent(plan.slug)}`); } }); }}>Организовать встречу</button>}<button className="intent-text-button" disabled={action.busy} onClick={() => setLeave(true)}>Покинуть комнату</button></div>}
      {leave && <div className="intent-confirm"><p>Выход закроет общение в этой комнате. Вернуться через прежнее предложение нельзя.</p><button className="intent-button" disabled={action.busy} onClick={removeSelf}>Подтвердить выход</button><button className="intent-text-button" onClick={() => setLeave(false)}>Остаться</button></div>}
    </section>
    {safety && <section className="intent-card intent-confirm" aria-label="Безопасность комнаты"><h2>{safety.kind === "report" ? `Жалоба на ${safety.member.alias}` : safety.kind === "block" ? `Заблокировать ${safety.member.alias}?` : `Удалить ${safety.member.alias}?`}</h2>{safety.kind === "report" ? <form onSubmit={safetySubmit}><label className="intent-field">Причина жалобы<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="spam">Спам</option><option value="harassment">Преследование или оскорбления</option><option value="unsafe_meeting">Небезопасная встреча</option><option value="impersonation">Выдаёт себя за другого</option><option value="other">Другое</option></select></label><label className="intent-field">Подробности жалобы (необязательно)<textarea rows={3} maxLength={1000} value={details} onChange={(event) => setDetails(event.target.value)} /></label><p className="intent-muted">Минимальные материалы жалобы будут доступны модераторам.</p><button className="intent-button" disabled={action.busy} type="submit">Отправить жалобу</button></form> : <><p>Общение в этой комнате будет закрыто. Скопированная информация и ранее отправленные планы останутся у участников.</p><button className="intent-button" disabled={action.busy} onClick={() => safetySubmit()}>{safety.kind === "block" ? "Подтвердить блокировку" : "Подтвердить удаление"}</button></>}<button className="intent-text-button" disabled={action.busy} onClick={() => { setSafety(null); setDetails(""); }}>Отмена</button></section>}
    <section className="intent-card intent-chat" aria-label="Переписка комнаты"><h2>Договоритесь о деталях</h2>{nextBefore && <button className="intent-text-button" disabled={action.busy} onClick={() => { void action.run(async (alive) => { const older = await productApi<{ messages: RoomMessageDTO[]; nextBefore: string | null }>(`${base}/messages?limit=50&before=${encodeURIComponent(nextBefore)}`); if (alive()) { setEarlier((old) => [...older.messages, ...old]); setOlderCursor(older.nextBefore); } }); }}>Более ранние сообщения</button>}{messages.length ? <ol className="intent-messages" aria-label="Сообщения комнаты">{messages.map((message) => <li key={message.publicKey} className={message.isMine ? "intent-message intent-message-mine" : "intent-message"}><div><strong>{message.isMine ? "Вы" : message.identity.alias}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></div><p>{message.text}</p></li>)}</ol> : <p className="intent-muted">Первое сообщение может быть простым: «Во сколько начинаем?»</p>}{writable ? <form onSubmit={send}><label className="intent-field">Сообщение<textarea rows={3} maxLength={2000} value={text} disabled={action.busy} onChange={(event) => setText(event.target.value)} /></label><div className="intent-actions"><button className="intent-button" disabled={action.busy || !text.trim()}>Отправить</button><span className="intent-muted">Обычный текст · {text.length}/2000</span></div></form> : <p className="intent-muted" role="status">Переписка завершена. Новые сообщения недоступны.</p>}</section><p className="intent-footnote">Для первой встречи выбирайте общественное место. Не сообщайте домашний адрес и расскажите о планах тому, кому доверяете.</p><ProductRefresh refresh={state.refresh} live={state.live} />
  </>}<Link className="intent-text-button" href="/people">Все комнаты</Link></ProductShell>;
}
