"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { customizationSchema, defaultCustomization, type Customization, type ProfileSpace } from "../schema";
import { projectSelfPreview } from "../projection";
import { ACCENTS, AVATARS, PROFILE_WORLDS, VISIBILITY, accentLabels, avatarLabels, blockLabels, visibilityLabels, worldLabels } from "../worlds";
import { ProfileAvatar, ProfileScene } from "./profile-scene";

type Block = Customization["blockOrder"][number];
type VisibilityField = keyof Customization["visibility"];
const descriptions: Record<Customization["world"], string> = { minimal: "Чистые линии, свободное пространство", midnight: "Глубокая ночь и свет орбит", glass: "Свет, прозрачность и мягкие градиенты", cozy: "Тёплая бумага и неспешный ритм", cyber: "Неон, координаты и цифровая сетка", manga: "Графика, растр и энергия комикса", y2k: "Хром, звёзды и настроение нулевых", monochrome: "Чёрное, белое и ясный контраст" };
const validationCopy: Record<string, string> = { status: "Статус — до 60 символов.", tagline: "Подпись — до 120 символов.", interests: "Добавьте до 8 разных интересов, каждый до 30 символов.", goals: "Добавьте до 3 разных целей, каждая до 80 символов.", selectedActivities: "Выберите до 6 занятий.", intentPostKey: "Выберите свою текущую заявку из списка." };
const lines = (value: string) => value.split("\n").map(line => line.trim()).filter(Boolean);

export function ProfileEditor({ space, onSave, busy = false }: { space: ProfileSpace; onSave: (settings: Customization) => Promise<void>; busy?: boolean }) {
  const initial = space.customization ?? defaultCustomization();
  const [draft, setDraft] = useState(initial);
  const [savedDraft, setSavedDraft] = useState(initial);
  const [interestsText, setInterestsText] = useState(initial.interests.join("\n"));
  const [goalsText, setGoalsText] = useState(initial.goals.join("\n"));
  const [preview, setPreview] = useState(() => projectSelfPreview(space, initial));
  const [view, setView] = useState<"settings" | "preview">("settings");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const alive = useRef(true);
  const submitting = useRef(false);
  const id = useId();
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const disabled = busy || pending;
  const valid = customizationSchema.safeParse(draft).success;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!dirty) return;
    const editorUrl = new URL(window.location.href);
    const editorHistoryState = window.history.state;
    const confirmDiscard = () => window.confirm("Есть несохранённые изменения. Уйти и отменить их?");
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const guardLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const target = new URL(link.href, window.location.href);
      if (!['http:', 'https:'].includes(target.protocol) || (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search)) return;
      if (!confirmDiscard()) {
        event.preventDefault(); event.stopImmediatePropagation();
      } else {
        // A normal document navigation must not ask a second time on unload.
        window.removeEventListener("beforeunload", guard);
      }
    };
    const guardHistory = (event: Event) => {
      if (window.location.pathname === editorUrl.pathname && window.location.search === editorUrl.search) return;
      if (!confirmDiscard()) {
        // The early history bootstrap runs before Next's popstate listener.
        // Restore the original route state when this navigation is cancelled.
        event.preventDefault();
        window.history.pushState(editorHistoryState, "", editorUrl.href);
      } else window.removeEventListener("beforeunload", guard);
    };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("click", guardLink, true);
    window.addEventListener("intavro:before-history-navigation", guardHistory, true);
    return () => { window.removeEventListener("beforeunload", guard); document.removeEventListener("click", guardLink, true); window.removeEventListener("intavro:before-history-navigation", guardHistory, true); };
  }, [dirty]);

  function update(next: Customization) {
    setDraft(next); setError(""); setNotice(""); setInvalidFields([]);
    const result = customizationSchema.safeParse(next);
    if (result.success) setPreview(projectSelfPreview(space, result.data));
  }
  function visibility(field: VisibilityField, value: Customization["visibility"]["status"]) {
    update({ ...draft, visibility: { ...draft.visibility, [field]: value } });
  }
  function reorder(block: Block, delta: number) {
    const order = [...draft.blockOrder];
    const from = order.indexOf(block), to = from + delta;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    update({ ...draft, blockOrder: order });
  }
  function reset() {
    update(savedDraft); setInterestsText(savedDraft.interests.join("\n")); setGoalsText(savedDraft.goals.join("\n"));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || submitting.current) return;
    const parsed = customizationSchema.safeParse(draft);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map(issue => String(issue.path[0])))];
      setInvalidFields(fields); setError(fields.map(field => validationCopy[field] ?? "Проверьте настройки пространства.").join(" "));
      return;
    }
    submitting.current = true; setPending(true); setError(""); setNotice("");
    try {
      await onSave(parsed.data);
      if (alive.current) { setSavedDraft(parsed.data); setDraft(parsed.data); setInterestsText(parsed.data.interests.join("\n")); setGoalsText(parsed.data.goals.join("\n")); setNotice("Сохранено. Ваше пространство обновлено."); }
    } catch {
      if (alive.current) setError("Не удалось сохранить пространство. Ваши изменения здесь — попробуйте ещё раз.");
    } finally { submitting.current = false; if (alive.current) setPending(false); }
  }
  function visibilitySelect(field: VisibilityField, label: string) {
    const labelId = `${id}-visibility-${field}`;
    return <label className="profile-visibility"><span id={labelId}>{label}</span><select aria-labelledby={labelId} value={draft.visibility[field]} onChange={event => visibility(field, event.target.value as Customization["visibility"]["status"])}>{VISIBILITY.map(value => <option key={value} value={value}>{visibilityLabels[value]}</option>)}</select></label>;
  }

  if (space.audience !== "self") return <p role="alert">Настройки доступны только владельцу пространства.</p>;

  return <section className="profile-editor" aria-label="Редактор пространства" data-view={view}>
    <div className="profile-editor-heading"><div><p className="profile-editor-eyebrow">ВАШ МАЛЕНЬКИЙ МИР</p><h2>Всё начинается с вас.</h2><p>Выберите настроение. Добавьте то, что важно.</p></div><span className="profile-editor-mark" aria-hidden="true">✳</span></div>
    <div className="profile-editor-view-switch" aria-label="Режим редактора"><button type="button" aria-pressed={view === "settings"} aria-controls={`${id}-settings`} onClick={() => setView("settings")}>Настройки</button><button type="button" aria-pressed={view === "preview"} aria-controls={`${id}-preview`} onClick={() => setView("preview")}>Предпросмотр</button></div>
    <div className="profile-editor-layout">
      <form id={`${id}-settings`} className="profile-editor-settings" onSubmit={save} noValidate>
        <fieldset className="profile-editor-fieldset" disabled={disabled}>
          <section className="profile-editor-section"><div className="profile-editor-section-heading"><span>01</span><h3>Ваш мир</h3></div><p className="profile-editor-hint">Один профиль. Восемь настроений.</p>
            <div className="profile-world-options">{PROFILE_WORLDS.map(world => <button className="profile-world-option" data-world={world} data-accent={draft.accent} type="button" key={world} aria-pressed={draft.world === world} onClick={() => update({ ...draft, world })}><span className="profile-world-sample" aria-hidden="true"><span>Аа</span><i /><b>✳</b></span><span className="profile-world-option-name">{worldLabels[world]}<span aria-hidden="true">{draft.world === world ? "✓" : "↗"}</span></span></button>)}</div>
            <p className="profile-editor-world-description">{descriptions[draft.world]}</p>
            <fieldset className="profile-choice-group"><legend>Акцент</legend><div className="profile-accent-options">{ACCENTS.map(accent => <button type="button" key={accent} data-accent={accent} aria-label={accentLabels[accent]} aria-pressed={draft.accent === accent} onClick={() => update({ ...draft, accent })}><span aria-hidden="true" /><span>{accentLabels[accent]}</span></button>)}</div></fieldset>
            <fieldset className="profile-choice-group"><legend>Аватар</legend><div className="profile-avatar-options">{AVATARS.map(avatar => <button type="button" key={avatar} aria-label={avatarLabels[avatar]} aria-pressed={draft.avatar === avatar} data-accent={draft.accent} onClick={() => update({ ...draft, avatar })}><ProfileAvatar avatar={avatar} small /><span>{avatarLabels[avatar]}</span></button>)}</div></fieldset>
          </section>
          <section className="profile-editor-section"><div className="profile-editor-section-heading"><span>02</span><h3>Несколько слов о себе</h3></div>
            <label className="profile-editor-field"><span>Статус</span><input maxLength={60} value={draft.status} aria-invalid={invalidFields.includes("status")} onChange={event => update({ ...draft, status: event.target.value })} placeholder="Например: открыт к маленьким приключениям" /></label>
            {visibilitySelect("status", "Кому виден статус")}
            <label className="profile-editor-field"><span id={`${id}-tagline-label`}>Подпись</span><textarea aria-labelledby={`${id}-tagline-label`} maxLength={120} rows={2} value={draft.tagline} aria-invalid={invalidFields.includes("tagline")} onChange={event => update({ ...draft, tagline: event.target.value })} placeholder="Одна фраза, в которой весь вы" /></label>
            {visibilitySelect("tagline", "Кому видна подпись")}
          </section>
          <section className="profile-editor-section"><div className="profile-editor-section-heading"><span>03</span><h3>Чем наполнить пространство</h3></div>
            <label className="profile-editor-field"><span id={`${id}-intent-label`}>Моя текущая заявка</span><select aria-labelledby={`${id}-intent-label`} value={draft.intentPostKey ?? ""} onChange={event => update({ ...draft, intentPostKey: event.target.value || null })}><option value="">Не показывать заявку</option>{space.intentOptions?.map(option => <option value={option.publicKey} key={option.publicKey}>{option.activityLabel}</option>)}</select></label>
            <p className="profile-editor-hint">Выберите существующую заявку. Новое занятие можно создать в поиске компании.</p>
            <fieldset className="profile-choice-group"><legend>Мои занятия <span>до 6</span></legend>{space.activityOptions?.length ? <div className="profile-activity-options">{space.activityOptions.map(activity => <label key={activity.activityKey}><input type="checkbox" aria-label={`Занятие: ${activity.activityLabel}`} checked={draft.selectedActivities.includes(activity.activityKey)} disabled={!draft.selectedActivities.includes(activity.activityKey) && draft.selectedActivities.length >= 6} onChange={event => update({ ...draft, selectedActivities: event.target.checked ? [...draft.selectedActivities, activity.activityKey] : draft.selectedActivities.filter(key => key !== activity.activityKey) })} /><span>{activity.activityLabel}</span><span>{activity.count} заявок</span></label>)}</div> : <p className="profile-editor-hint">Здесь появятся занятия из ваших заявок.</p>}</fieldset>
            <label className="profile-editor-field"><span id={`${id}-interests-label`}>Интересы — каждый с новой строки</span><textarea aria-labelledby={`${id}-interests-label`} rows={3} value={interestsText} aria-invalid={invalidFields.includes("interests")} onChange={event => { setInterestsText(event.target.value); update({ ...draft, interests: lines(event.target.value) }); }} placeholder={"Кино\nГородские прогулки\nНастольные игры"} /></label><p className="profile-editor-hint">До 8 разных интересов, каждый до 30 символов.</p>
            <label className="profile-editor-field"><span id={`${id}-goals-label`}>Цели — каждая с новой строки</span><textarea aria-labelledby={`${id}-goals-label`} rows={3} value={goalsText} aria-invalid={invalidFields.includes("goals")} onChange={event => { setGoalsText(event.target.value); update({ ...draft, goals: lines(event.target.value) }); }} placeholder="Например: попробовать что-то впервые" /></label><p className="profile-editor-hint">До 3 целей, каждая до 80 символов.</p>
          </section>
          <section className="profile-editor-section"><div className="profile-editor-section-heading"><span>04</span><h3>Порядок и видимость</h3></div><p className="profile-editor-hint">Поднимайте важное выше. Решайте, чем делиться.</p>
            <ol className="profile-block-settings">{draft.blockOrder.map((block, index) => <li key={block}><div className="profile-block-setting-top"><label><input type="checkbox" aria-label={`Показывать: ${blockLabels[block]}`} checked={draft.enabledBlocks.includes(block)} onChange={event => update({ ...draft, enabledBlocks: event.target.checked ? [...draft.enabledBlocks, block] : draft.enabledBlocks.filter(item => item !== block) })} /><span>{blockLabels[block]}</span></label><div className="profile-reorder"><button type="button" aria-label={`${blockLabels[block]}: выше`} disabled={index === 0} onClick={() => reorder(block, -1)}>↑</button><button type="button" aria-label={`${blockLabels[block]}: ниже`} disabled={index === draft.blockOrder.length - 1} onClick={() => reorder(block, 1)}>↓</button></div></div>{visibilitySelect(block, `Кому виден блок: ${blockLabels[block]}`)}</li>)}</ol>
            <p className="profile-editor-privacy-note">В режиме «Инкогнито» другие видят отдельный образ для каждой пары. Общие настройки и сведения скрыты, даже после знакомства.</p>
          </section>
        </fieldset>
        <div className="profile-editor-save"><button className="button button-primary" type="submit" disabled={disabled}>{disabled ? "Сохраняем…" : "Сохранить пространство"}</button><button type="button" className="profile-reset" disabled={!dirty || disabled} onClick={reset}>Отменить изменения</button>{error && <p role="alert" className="entry-error">{error}</p>}{notice && <p role="status" className="profile-save-notice">{notice}</p>}<p className="profile-editor-hint">{dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}</p></div>
      </form>
      <div id={`${id}-preview`} className="profile-editor-preview" role="region" aria-label="Предпросмотр пространства"><div className="profile-preview-heading"><span>ПРЕДПРОСМОТР</span><span>Только для вас <span aria-hidden="true">↗</span></span></div><ProfileScene space={preview} /><p className="profile-preview-note">{valid ? "Так пространство выглядит для вас. Другие увидят только разрешённые сведения." : "Предпросмотр показывает последние корректные настройки. Проверьте заполненные поля."}</p><button className="profile-preview-back" type="button" onClick={() => setView("settings")}>Вернуться к настройкам</button></div>
    </div>
  </section>;
}
