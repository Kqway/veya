"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AvailabilityPicker } from "@/features/entry/components/availability-picker";
import {
  dateKey,
  validateEntryAvailability,
  type Availability,
} from "@/features/entry/form-values";
import {
  ageBands,
  csv,
  privacyModes,
  privacyLabels,
  interactionLabels,
  formatLabels,
  skillLabels,
  socialApi,
  useSocialAction,
  type OwnPost,
  type PrivacyMode,
  type Profile,
  type SeekingInput,
  type Suggestion,
} from "../client";
import { PrivacyCopy, SocialError } from "./common";
const suggestionLabels: Record<keyof Suggestion, string> = {
  activityKey: "Код занятия",
  activityLabel: "Название занятия",
  interactionMode: "Способ встречи",
  format: "Формат",
  city: "Город",
  area: "Район",
  skill: "Уровень опыта",
  languages: "Языки",
  tags: "Теги",
  timeHint: "Подсказка по времени",
};
const empty = {
  rawText: "",
  activityKey: "",
  activityLabel: "",
  interactionMode: "in_person" as SeekingInput["interactionMode"],
  format: "one_to_one" as SeekingInput["format"],
  city: "",
  area: "",
  skill: "any" as SeekingInput["skill"],
  languages: "ru",
  tags: "",
  groupSize: "",
  expiry: "",
};
export function SeekingForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [defaultExpiry] = useState(() =>
    new Date(Date.now() + 7 * 86_400_000).toISOString(),
  );
  const [fields, setFields] = useState(() => ({
      ...empty,
      expiry: dateKey(new Date(defaultExpiry)),
    })),
    [availability, setAvailability] = useState<Availability[]>([]),
    [desiredAgeBands, setDesiredAgeBands] = useState<string[]>([]),
    [privacy, setPrivacy] = useState<PrivacyMode>(profile.privacyMode),
    [suggestion, setSuggestion] = useState<Suggestion | null>(null),
    [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const action = useSocialAction();
  const [dateBounds] = useState(() => ({
    min: dateKey(new Date()),
    max: dateKey(new Date(Date.now() + 30 * 86_400_000)),
    fallback: new Date().toISOString(),
  }));
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const rawText = sessionStorage.getItem("veya.social.draft");
        if (rawText) {
          setFields((f) => ({ ...f, rawText: rawText.slice(0, 500) }));
          sessionStorage.removeItem("veya.social.draft");
        }
      } catch {}
    });
    return () => {
      cancelled = true;
    };
  }, []);
  function set<K extends keyof typeof fields>(
    key: K,
    value: (typeof fields)[K],
  ) {
    setFields((f) => ({ ...f, [key]: value }));
  }
  function expiresAt() {
    const date =
      fields.expiry === dateKey(new Date(defaultExpiry))
        ? new Date(defaultExpiry)
        : new Date(`${fields.expiry}T23:59:59`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.getTime() <= Date.now() ||
      date.getTime() > Date.now() + 30 * 86_400_000
    )
      throw new Error("Выберите срок действия в пределах следующих 30 дней.");
    return date.toISOString();
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void action.run(async (alive) => {
      const expiry = expiresAt();
      validateEntryAvailability(availability, expiry);
      if (availability.length > 14)
        throw new Error("Выберите не более 14 временных интервалов.");
      if (!fields.rawText.trim() || fields.rawText.trim().length > 500)
        throw new Error("Опишите занятие, используя не более 500 символов.");
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.activityKey) ||
        fields.activityKey.length > 40 ||
        !fields.activityLabel.trim() ||
        fields.activityLabel.trim().length > 80
      )
        throw new Error(
          "Укажите код занятия (строчные латинские слова через дефис) и название занятия.",
        );
      if (fields.interactionMode !== "online" && !fields.city.trim())
        throw new Error("Укажите город для занятия вживую.");
      const languages = csv(fields.languages, 5, 20, true);
      if (languages.some((v) => !/^[a-z]{2}(?:-[a-z]{2})?$/.test(v)))
        throw new Error("Используйте коды языков, например ru, en или en-us.");
      const groupSize = fields.groupSize ? Number(fields.groupSize) : null;
      if (
        groupSize !== null &&
        (!Number.isInteger(groupSize) ||
          groupSize < 2 ||
          groupSize > 12 ||
          fields.format === "one_to_one")
      )
        throw new Error(
          "Для занятия в группе выберите от 2 до 12 участников.",
        );
      const input: SeekingInput = {
        rawText: fields.rawText.trim(),
        activityKey: fields.activityKey,
        activityLabel: fields.activityLabel.trim(),
        interactionMode: fields.interactionMode,
        format: fields.format,
        city: fields.city.trim() || null,
        area: fields.area.trim() || null,
        skill: fields.skill,
        languages,
        tags: csv(fields.tags, 8, 40),
        availability,
        desiredAgeBands,
        groupSize,
        privacyMode:
          order[privacy] >= order[profile.privacyMode]
            ? privacy
            : profile.privacyMode,
        expiresAt: expiry,
      };
      const data = await socialApi<OwnPost>("/seeking", "POST", input);
      if (alive()) router.push(`/seek/${encodeURIComponent(data.publicKey)}`);
    });
  }
  const order = { OPEN: 0, PRIVATE: 1, INCOGNITO: 2 };
  return (
    <form className="social-card" onSubmit={submit} noValidate>
      <h2>Ваше занятие на ваших условиях</h2>
      <p>
        Выберите занятие и время, когда вы действительно свободны. Не указывайте домашний адрес или точное местоположение. Подбор учитывает занятие, формат встречи, общий язык и совпадающее свободное время в будущем.
      </p>
      <fieldset disabled={action.busy}>
        <label className="field">
          Чем хотите заняться?
          <textarea
            maxLength={500}
            rows={3}
            value={fields.rawText}
            onChange={(e) => set("rawText", e.target.value)}
          />
        </label>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            void action.run(async (alive) => {
              if (!fields.rawText.trim())
                throw new Error("Сначала опишите занятие.");
              const data = await socialApi<{
                data: Suggestion;
                source: string;
              }>("/ai/seeking", "POST", {
                text: fields.rawText.trim(),
                referenceDate: dateKey(new Date()),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              });
              if (alive()) setSuggestion(data.data);
            });
          }}
        >
          Помочь с заполнением
        </button>
        <p className="quiet-copy">
          Помощь необязательна. Проверьте предложения перед применением. Вы можете изменить любое поле или заполнить всё вручную без ИИ. Можно добавить и занятие, которого нет в списке.
        </p>
        {suggestion && (
          <section className="social-preview" aria-label="Проверка предложения">
            <h3>Предложенные сведения</h3>
            <dl>
              {Object.entries(suggestion).map(([key, value]) => (
                <div key={key}>
                  <dt>{suggestionLabels[key as keyof Suggestion]}</dt>
                  <dd>
                    {Array.isArray(value)
                      ? value.join(", ") || "Нет предложений"
                      : key === "interactionMode" && suggestion.interactionMode
                        ? interactionLabels[suggestion.interactionMode]
                        : key === "format" && suggestion.format
                          ? formatLabels[suggestion.format]
                          : key === "skill" && suggestion.skill
                            ? skillLabels[suggestion.skill]
                            : (value ?? "Нет предложений")}
                  </dd>
                </div>
              ))}
            </dl>
            <p>Подсказки по времени — только рекомендации. Укажите своё свободное время ниже.</p>
            <div className="social-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setFields((f) => ({
                    ...f,
                    activityKey: suggestion.activityKey ?? f.activityKey,
                    activityLabel: suggestion.activityLabel ?? f.activityLabel,
                    interactionMode:
                      suggestion.interactionMode ?? f.interactionMode,
                    format: suggestion.format ?? f.format,
                    city: suggestion.city ?? f.city,
                    area: suggestion.area ?? f.area,
                    skill: suggestion.skill ?? f.skill,
                    languages: suggestion.languages.length
                      ? suggestion.languages.join(", ")
                      : f.languages,
                    tags: suggestion.tags.join(", "),
                  }));
                  setSuggestion(null);
                }}
              >
                Применить проверенное предложение
              </button>
              <button
                className="social-text-button"
                type="button"
                onClick={() => setSuggestion(null)}
              >
                Оставить мои сведения
              </button>
            </div>
          </section>
        )}
        <p className="quiet-copy">Код занятия объединяет одинаковые занятия. Используйте короткое название латиницей, например chess или pottery. Несколько слов соединяйте дефисами. Название занятия — это то, что увидят другие люди.</p>
        <div className="social-grid">
          <label className="field">
            Код занятия
            <input
              value={fields.activityKey}
              onChange={(e) => set("activityKey", e.target.value)}
              maxLength={40}
              placeholder="chess"
            />
          </label>
          <label className="field">
            Название занятия
            <input
              value={fields.activityLabel}
              onChange={(e) => set("activityLabel", e.target.value)}
              maxLength={80}
              placeholder="Шахматы"
            />
          </label>
          <label className="field">
            Способ встречи
            <select
              value={fields.interactionMode}
              onChange={(e) =>
                set(
                  "interactionMode",
                  e.target.value as SeekingInput["interactionMode"],
                )
              }
            >
              <option value="in_person">Вживую</option>
              <option value="online">Онлайн</option>
              <option value="either">Любой вариант</option>
            </select>
          </label>
          <label className="field">
            Формат
            <select
              value={fields.format}
              onChange={(e) => {
                const format = e.target.value as SeekingInput["format"];
                setFields((f) => ({
                  ...f,
                  format,
                  ...(format === "one_to_one" ? { groupSize: "" } : {}),
                }));
              }}
            >
              <option value="one_to_one">Вдвоём</option>
              <option value="group">В группе</option>
              <option value="either">Любой вариант</option>
            </select>
          </label>
          <label className="field">
            Город
            <input
              value={fields.city}
              onChange={(e) => set("city", e.target.value)}
              maxLength={60}
            />
          </label>
          <label className="field">
            Район (необязательно)
            <input
              value={fields.area}
              onChange={(e) => set("area", e.target.value)}
              maxLength={60}
              placeholder="Район, без точного адреса"
            />
          </label>
          <label className="field">
            Уровень опыта
            <select
              value={fields.skill}
              onChange={(e) =>
                set("skill", e.target.value as SeekingInput["skill"])
              }
            >
              {[
                "any",
                "beginner",
                "casual",
                "intermediate",
                "advanced",
                "expert",
              ].map((v) => (
                <option key={v} value={v}>{skillLabels[v as SeekingInput["skill"]]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Языки
            <input
              value={fields.languages}
              onChange={(e) => set("languages", e.target.value)}
              maxLength={104}
              placeholder="ru, en"
            />
          </label>
          <label className="field">
            Теги (необязательно)
            <input
              value={fields.tags}
              onChange={(e) => set("tags", e.target.value)}
              maxLength={334}
              placeholder="для отдыха, на природе"
            />
          </label>
          <label className="field">
            Размер группы (необязательно)
            <input
              type="number"
              min={2}
              max={12}
              disabled={fields.format === "one_to_one"}
              value={fields.groupSize}
              onChange={(e) => set("groupSize", e.target.value)}
            />
          </label>
          <label className="field">
            Приватность заявки
            <select
              value={
                order[privacy] >= order[profile.privacyMode]
                  ? privacy
                  : profile.privacyMode
              }
              onChange={(e) => setPrivacy(e.target.value as PrivacyMode)}
            >
              {privacyModes
                .filter((p) => order[p] >= order[profile.privacyMode])
                .map((p) => (
                  <option key={p} value={p}>{privacyLabels[p]}</option>
                ))}
            </select>
          </label>
          <label className="field">
            Действует до
            <input
              type="date"
              value={fields.expiry}
              min={dateBounds.min}
              max={dateBounds.max}
              onChange={(e) => set("expiry", e.target.value)}
            />
          </label>
        </div>
        <p className="quiet-copy">
          Укажите до 5 кодов языков через запятую и до 8 тегов. Приватность заявки может быть только такой же или более строгой, чем приватность профиля.
        </p>
        <fieldset className="social-age">
          <legend>Предпочтительные возрастные группы (необязательно)</legend>
          <p className="quiet-copy">
            Не выбирайте ничего, если ограничений нет. Люди, не указавшие возрастную группу, не подходят под возрастные ограничения.
          </p>
          {ageBands.map((b) => (
            <label className="social-check" key={b}>
              <input
                type="checkbox"
                checked={desiredAgeBands.includes(b)}
                onChange={(e) =>
                  setDesiredAgeBands((values) =>
                    e.target.checked
                      ? [...values, b]
                      : values.filter((v) => v !== b),
                  )
                }
              />
              {b}
            </label>
          ))}
        </fieldset>
        <PrivacyCopy />
        <AvailabilityPicker
          value={availability}
          onChange={(windows) => {
            if (windows.length > 14) {
              setAvailabilityError("Выберите не более 14 временных интервалов.");
              return;
            }
            setAvailability(windows);
            setAvailabilityError(null);
          }}
          expiresAt={
            fields.expiry === dateKey(new Date(defaultExpiry))
              ? defaultExpiry
              : Number.isFinite(Date.parse(`${fields.expiry}T23:59:59`))
                ? new Date(`${fields.expiry}T23:59:59`).toISOString()
                : dateBounds.fallback
          }
        />
        <SocialError message={availabilityError} />
        <p className="quiet-copy">
          Выберите от 1 до 14 временных интервалов в будущем. При поиске людей ваше точное расписание остаётся скрытым.
        </p>
        <button className="button button-primary" type="submit">
          {action.busy ? "Сохраняем…" : "Создать заявку на занятие"}
        </button>
      </fieldset>
      <SocialError message={action.error} focusRef={action.errorRef} />
    </form>
  );
}
