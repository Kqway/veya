"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useSocialAction } from "@/features/social/client";
import type { Interpretation, OfferDTO, Preference, RoomDTO, SearchDTO, SearchDraft } from "../schema";
import { MinimalOnboarding } from "./minimal-onboarding";
import { OfferCard, RoomCard, SearchCard } from "./intent-cards";
import { ProductError, ProductRefresh, ProductShell, ProductUnavailable, productApi, useProductData, useUnsavedGuard } from "./product-common";
import { AttributeSummary } from "./activity-attributes";
const suggestions = ["Нужен пятый в Dota сегодня вечером", "Хочу в зал завтра вечером", "Учить английский онлайн сегодня вечером"];
const readHome = async () => {
  const [searches, offers, rooms] = await Promise.all([productApi<{ searches: SearchDTO[] }>("/searches"), productApi<{ offers: OfferDTO[] }>("/offers"), productApi<{ rooms: RoomDTO[] }>("/rooms")]);
  return { searches: searches.searches, offers: offers.offers, rooms: rooms.rooms };
};
export function NowScreen() {
  const state = useProductData(readHome, { searches: [] as SearchDTO[], offers: [] as OfferDTO[], rooms: [] as RoomDTO[] });
  const [text, setText] = useState("");
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [newIntent, setNewIntent] = useState(false);
  const [editing, setEditing] = useState<SearchDTO | null>(null);
  const [notice, setNotice] = useState("");
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const input = useRef<HTMLTextAreaElement>(null);
  const action = useSocialAction();
  useUnsavedGuard(!!text.trim() || !!interpretation || !!editing);
  const active = state.data.searches.filter((search) => search.status === "active");
  const contextualSearch = editing ?? (!newIntent && active.length === 1 ? active[0] : null);
  const ownDraft: SearchDraft | undefined = interpretation?.kind === "draft" ? interpretation.draft : interpretation?.kind === "clarification" ? interpretation.draft ?? undefined : contextualSearch?.ownDraft;
  function interpret(event?: FormEvent, answer?: string) {
    event?.preventDefault();
    void action.run(async (alive) => {
      const value = (answer ?? text).trim();
      if (!value) { input.current?.focus(); throw new Error("Расскажите, что хотите сделать."); }
      if (value.length > 500) throw new Error("Используйте не более 500 символов.");
      const referenceDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const result = await productApi<{ interpretation: Interpretation }>("/interpret", "POST", { text: value, timezone, referenceDate, ...(ownDraft ? { draft: ownDraft } : {}), ...(interpretation?.kind === "clarification" && interpretation.partialDraft ? { partialDraft: interpretation.partialDraft } : {}) });
      if (alive()) {
        const parsed = result.interpretation;
        if (parsed.kind === "draft" || parsed.kind === "clarification") {
          const nextKey = parsed.kind === "draft" ? parsed.draft.seeking.activityKey : parsed.partialDraft?.seeking.activityKey;
          setEditing(contextualSearch && (!nextKey || nextKey === contextualSearch.ownDraft?.seeking.activityKey) ? contextualSearch : null);
          if (contextualSearch && nextKey && nextKey !== contextualSearch.ownDraft?.seeking.activityKey) setNewIntent(true);
        }
        setInterpretation(parsed); setText(""); setNotice("");
      }
    });
  }
  function reset() { setNewIntent(false); setText(""); setInterpretation(null); setEditing(null); setNotice(""); input.current?.focus(); }
  function submitDraft() {
    if (interpretation?.kind !== "draft") return;
    void action.run(async (alive) => {
      await productApi(editing ? `/searches/${encodeURIComponent(editing.publicKey)}` : "/searches", editing ? "PATCH" : "POST", { draft: interpretation.draft, consent: true });
      if (!alive()) return;
      reset(); setNotice(editing ? "Поиск обновлён. Прежние непринятые предложения отменены." : "Поиск начат. Совместимые люди получат предложение.");
      await state.refresh();
    });
  }
  function command(search: SearchDTO, type: "stop" | "extend", minutes = 60) {
    void action.run(async (alive) => {
      await productApi(`/searches/${encodeURIComponent(search.publicKey)}/command`, "POST", { type, ...(type === "extend" ? { minutes } : {}) });
      if (!alive()) return;
      reset(); setNotice(type === "stop" ? "Поиск остановлен. Непринятые предложения отменены." : "Поиск продлён."); await state.refresh();
    });
  }
  function savePreference() {
    if (interpretation?.kind !== "preference") return;
    const understood = interpretation.preference;
    void action.run(async (alive) => {
      const { preferences } = await productApi<{ preferences: Preference }>("/preferences");
      const next: Preference = understood.type === "offers" ? { ...preferences, offersEnabled: understood.offersEnabled ?? preferences.offersEnabled } : understood.type === "quiet_hours" ? { ...preferences, timezone, quietHours: understood.quietHours ?? null } : { ...preferences, activities: [...preferences.activities.filter((rule) => rule.activityKey !== understood.activityKey), { activityKey: understood.activityKey!, attributes: understood.attributes ?? {}, enabled: true }] };
      await productApi("/preferences", "PATCH", next);
      if (alive()) { reset(); setNotice("Правило сохранено. Вы можете изменить или удалить его в настройках."); }
    });
  }
  const rooms = state.data.rooms.filter((room) => !["completed", "archived", "closed"].includes(room.status));
  const selectedCommandSearch = editing ?? (active.length === 1 ? active[0] : null);
  return <ProductShell title="Что хочешь сделать?" eyebrow="Intavro / сейчас">
    <p className="intent-intro">Одно намерение. Подходящая компания. Дальше — вместе.</p>
    <div className="intent-composer"><form onSubmit={interpret}><label className="intent-sr-only" htmlFor="intent-text">Что хочешь сделать?</label><textarea id="intent-text" ref={input} rows={2} maxLength={500} value={text} disabled={action.busy || state.restricted} placeholder={interpretation?.kind === "clarification" ? "Короткий ответ…" : editing ? "Что изменить в поиске?" : "Например, нужен пятый в Dota сегодня вечером"} onChange={(event) => setText(event.target.value)} /><button className="intent-compose-send" type="submit" disabled={action.busy || state.restricted} aria-label={interpretation?.kind === "clarification" ? "Ответить" : "Разобрать намерение"}>{action.busy ? "…" : "↑"}</button></form>{!interpretation && !editing && <div className="intent-suggestions" aria-label="Идеи для начала">{suggestions.map((suggestion) => <button key={suggestion} disabled={action.busy} onClick={() => { setText(suggestion); input.current?.focus(); }}>{suggestion}</button>)}</div>}</div>
    {contextualSearch && <p className="intent-muted">Текущий поиск: {contextualSearch.activityLabel}. Допишите, что изменить. Уже открытые комнаты сохраняют свои условия.</p>}
    {active.length > 0 && <button className="intent-text-button" disabled={action.busy} onClick={() => { reset(); setNewIntent(true); }}>Новое намерение</button>}
    {newIntent && <p className="intent-muted">Новое намерение — текущие поиски продолжаются.</p>}
    <ProductError message={action.error ?? state.error} retry={state.error ? state.refresh : undefined} />
    {notice && <p className="intent-notice" role="status">{notice}</p>}
    {interpretation && <section className="intent-card intent-understood" aria-label="Понятое намерение"><p className="intent-eyebrow">Понял так</p><p className="intent-summary">{interpretation.summary}</p>
      {interpretation.kind === "clarification" && <div className="intent-question"><h2>{interpretation.question.text}</h2><div className="intent-actions">{interpretation.question.options.map((option) => <button key={option.value} className="intent-chip" disabled={action.busy} onClick={() => interpret(undefined, option.value)}>{option.label}</button>)}</div></div>}
      {interpretation.kind === "draft" && <><dl className="intent-preview"><div><dt>Занятие</dt><dd>{interpretation.draft.seeking.activityLabel}</dd></div><div><dt>Формат</dt><dd>{interpretation.draft.seeking.interactionMode === "online" ? "Онлайн" : interpretation.draft.seeking.city ?? "Вживую"}</dd></div><div><dt>Компания</dt><dd>Уже есть {interpretation.draft.existingPeople}, ищем ещё {interpretation.draft.neededPeople}</dd></div><div><dt>Время</dt><dd>{interpretation.draft.seeking.availability.map((window) => `${new Date(window.startAt).toLocaleString("ru-RU", { timeZone: interpretation.draft.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — ${new Date(window.endAt).toLocaleTimeString("ru-RU", { timeZone: interpretation.draft.timezone, hour: "2-digit", minute: "2-digit" })}`).join("; ")} ({interpretation.draft.timezone})</dd></div></dl><AttributeSummary attributes={interpretation.draft.attributes} /><p className="intent-muted">{editing ? "Подтверждение обновит ваш поиск и отменит прежние непринятые предложения." : "«Начать» создаст поиск и разрешит отправить совместимым людям предложение. Они сами решат, присоединиться ли."}</p>{state.profile && <button className="intent-button" disabled={action.busy} onClick={submitDraft}>{editing ? "Сохранить изменения" : "Начать"}</button>}</>}
      {interpretation.kind === "preference" && <><p className="intent-muted">Это правило будет видно только вам. Оно действует после подтверждения.</p>{state.profile && <button className="intent-button" disabled={action.busy} onClick={savePreference}>Подтвердить правило</button>}<Link className="intent-text-button" href="/preferences">Мои правила</Link></>}
      {interpretation.kind === "command" && <>{active.length > 1 && <label className="intent-field">Какой поиск изменить?<select value={editing?.publicKey ?? ""} onChange={(event) => setEditing(active.find((search) => search.publicKey === event.target.value) ?? null)}><option value="">Выберите поиск</option>{active.map((search) => <option key={search.publicKey} value={search.publicKey}>{search.activityLabel}</option>)}</select></label>}{!selectedCommandSearch && <p>Выберите поиск ниже, чтобы применить команду.</p>}{selectedCommandSearch && <button className="intent-button" disabled={action.busy} onClick={() => command(selectedCommandSearch, interpretation.command.type, interpretation.command.type === "extend" ? interpretation.command.minutes : undefined)}>{interpretation.command.type === "stop" ? "Подтвердить остановку" : "Подтвердить продление"}: {selectedCommandSearch.activityLabel}</button>}</>}
      <button className="intent-text-button" disabled={action.busy} onClick={reset}>Сбросить</button>
    </section>}
    {!state.loaded && <p className="intent-muted" role="status">Проверяем ваши текущие намерения…</p>}
    {state.loaded && state.restricted && <ProductUnavailable restricted />}
    {state.loaded && !state.profile && !state.restricted && !state.error && <MinimalOnboarding onCreated={state.refresh} />}
    {state.profile && <>
      {state.data.offers.some((offer) => offer.status === "pending") && <section className="intent-section" aria-labelledby="incoming-title"><h2 id="incoming-title">Вам предлагают</h2>{state.data.offers.filter((offer) => offer.status === "pending").map((offer) => <OfferCard key={offer.publicKey} offer={offer} busy={action.busy} onRespond={(response) => { void action.run(async (alive) => { const { offer: updated } = await productApi<{ offer: OfferDTO }>(`/offers/${encodeURIComponent(offer.publicKey)}/respond`, "POST", { action: response }); if (alive()) { setNotice(response === "accept" ? updated.roomKey ? "Компания собралась. Комната готова." : "Вы в деле. Комната откроется, когда компания соберётся." : "Предложение отклонено."); await state.refresh(); } }); }} />)}</section>}
      {state.data.offers.filter((offer) => offer.status === "accepted" && !offer.roomKey).map((offer) => <div className="intent-card" key={offer.publicKey}><h3>{offer.activityLabel}</h3><p>Вы в деле. Ждём, когда компания соберётся.</p><Link className="intent-text-button" href={`/offer/${encodeURIComponent(offer.publicKey)}`}>Ваше принятое предложение</Link></div>)}
      {state.data.searches.length > 0 && <section className="intent-section" aria-labelledby="current-title"><h2 id="current-title">Ваши намерения</h2>{state.data.searches.map((search) => <SearchCard key={search.publicKey} search={search} busy={action.busy} onEdit={() => { setNewIntent(false); setEditing(search); setInterpretation(null); setText(""); input.current?.focus(); }} onCommand={(type) => command(search, type)} />)}</section>}
      {rooms.length > 0 && <section className="intent-section" aria-labelledby="room-title"><h2 id="room-title">Можно начинать</h2>{rooms.map((room) => <RoomCard key={room.publicKey} room={room} />)}</section>}
      <ProductRefresh refresh={state.refresh} live={state.live} />
    </>}
    <div className="intent-secondary"><Link href="/seek/new">Расширенный поиск</Link><span aria-hidden="true">·</span><Link href="/plan">Встреча с друзьями</Link><span aria-hidden="true">·</span><Link href="/preferences">Мои правила</Link></div>
    <p className="intent-footnote">Помощник разбирает только ваши слова. Правила и поиски видны вам; переписку людей он не читает.</p>
  </ProductShell>;
}
