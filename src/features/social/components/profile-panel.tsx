"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ApiError } from "@/features/entry/client";
import {
  ageBands,
  csv,
  ensureGuest,
  privacyModes,
  privacyLabels,
  socialApi,
  useSocialAction,
  type Profile,
  type PrivacyMode,
} from "../client";
import { useRecoveryKey } from "./recovery-key-provider";
import { Person, PrivacyCopy, SocialError } from "./common";
export function ProfilePanel({
  profile,
  onProfile,
  restricted = false,
}: {
  profile: Profile | null;
  onProfile: (profile: Profile | null) => void;
  restricted?: boolean;
}) {
  const [alias, setAlias] = useState(profile?.alias ?? ""),
    [privacy, setPrivacy] = useState<PrivacyMode>(
      profile?.privacyMode ?? "PRIVATE",
    );
  const [adult, setAdult] = useState(false),
    [age, setAge] = useState(profile?.ageBand ?? ""),
    [languages, setLanguages] = useState(profile?.languages.join(", ") ?? "ru");
  const [recovery, setRecovery] = useState(""),
    [showRecover, setShowRecover] = useState(false),
    [revoke, setRevoke] = useState(false),
    [deletion, setDeletion] = useState(false),
    [confirmation, setConfirmation] = useState(""),
    [notice, setNotice] = useState("");
  const action = useSocialAction();
  const { key: oneTimeKey, showKey: setOneTimeKey, clearKey } = useRecoveryKey();
  function save(event: FormEvent) {
    event.preventDefault();
    void action.run(async (alive) => {
      setNotice("");
      if (!profile && !adult)
        throw new Error(
          "Для создания профиля подтвердите, что вам исполнилось 18 лет.",
        );
      if (!alias.trim() || alias.trim().length > 60)
        throw new Error("Выберите псевдоним длиной до 60 символов.");
      const parsed = csv(languages, 5, 20);
      if (parsed.some((v) => !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(v)))
        throw new Error("Используйте коды языков, например ru, en или fr.");
      if (!profile) {
        await ensureGuest();
        if (!alive()) return;
      }
      const data = await socialApi<{ profile: Profile; recoveryKey?: string }>(
        "/profile",
        profile ? "PATCH" : "POST",
        {
          alias: alias.trim(),
          privacyMode: privacy,
          ageBand: age || null,
          languages: parsed,
          ...(!profile ? { adultConfirmed: true } : {}),
        },
      );
      if (!profile) window.dispatchEvent(new Event("veya:social-profile-changed"));
      if (data.recoveryKey) setOneTimeKey(data.recoveryKey);
      if (alive()) onProfile(data.profile);
    });
  }
  function remove(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== "DELETE") return;
    void action.run(async (alive) => {
      const data = await socialApi<{ deleted: true }>("/profile", "DELETE", { confirmation: "DELETE" });
      if (data.deleted !== true) throw new Error("Удаление не подтверждено. Попробуйте снова.");
      clearKey();
      try { sessionStorage.removeItem("veya.social.draft"); } catch {}
      window.dispatchEvent(new Event("veya:social-profile-changed"));
      if (alive()) {
        setDeletion(false);
        setConfirmation("");
        setRevoke(false);
        setAlias("");
        setAdult(false);
        setAge("");
        setLanguages("ru");
        setPrivacy("PRIVATE");
        setRecovery("");
        setShowRecover(false);
        setNotice("Ваш профиль Veya удалён.");
        onProfile(null);
      }
    });
  }
  return (
    <section className="social-card" aria-label="Ваш профиль Veya">
      <h2>{restricted ? "Ваш профиль недоступен" : profile ? "Ваш профиль" : "Выберите, как вас будут видеть"}</h2>
      {restricted && <p>Вы по-прежнему можете удалить профиль Veya, связанный с этой сессией браузера.</p>}
      {!profile && !restricted && <p>Создайте профиль Veya — только для взрослых (18+), сохраните Ключ Veya и начните с вашей цели. Электронная почта и пароль не нужны.</p>}
      {profile && <><Person identity={profile} /><p><Link className="social-text-button" href="/profile">Открыть своё пространство</Link> · <Link className="social-text-button" href="/profile/edit">Настроить профиль</Link></p></>}
      <PrivacyCopy />
      {notice && <p role="status">{notice}</p>}
      {!oneTimeKey && !restricted && (
        <>
          <form onSubmit={save} noValidate>
            <fieldset disabled={action.busy}>
              <label className="field">
                Псевдоним
                <input
                  maxLength={60}
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                Приватность
                <select
                  value={privacy}
                  onChange={(e) => setPrivacy(e.target.value as PrivacyMode)}
                >
                  {privacyModes.map((mode) => (
                    <option key={mode} value={mode}>{privacyLabels[mode]}</option>
                  ))}
                </select>
              </label>
              <p className="quiet-copy">
                Режим «Открытый» показывает выбранный псевдоним и разрешённые общие сведения. Режим «Приватный» использует выбранный вами псевдоним. В режиме «Инкогнито» для каждой пары создаётся отдельный псевдоним.
              </p>
              <label className="field">
                Возрастная группа (необязательно)
                <select value={age} onChange={(e) => setAge(e.target.value)}>
                  <option value="">Не хочу указывать</option>
                  {ageBands.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Языки профиля (необязательно)
                <input
                  value={languages}
                  onChange={(e) => setLanguages(e.target.value)}
                  maxLength={104}
                  placeholder="ru, en"
                />
              </label>
              {!profile && (
                <label className="social-check">
                  <input
                    type="checkbox"
                    checked={adult}
                    onChange={(e) => setAdult(e.target.checked)}
                  />
                  Мне исполнилось 18 лет
                </label>
              )}
              <button className="button button-primary" type="submit">
                {action.busy
                  ? "Сохраняем…"
                  : profile
                    ? "Сохранить профиль"
                    : "Создать профиль"}
              </button>
            </fieldset>
          </form>
          {!profile && (
            <>
              <button
                className="social-text-button"
                onClick={() => setShowRecover(!showRecover)}
              >
                Восстановить с помощью Ключа Veya
              </button>
              {showRecover && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action.run(async (alive) => {
                      setNotice("");
                      if (!/^[A-Za-z0-9_-]{43}$/.test(recovery.trim()))
                        throw new Error("Введите Ключ Veya из 43 символов.");
                      await ensureGuest();
                      if (!alive()) return;
                      const data = await socialApi<{
                        profile: Profile;
                        recoveryKey: string;
                      }>("/profile/recover", "POST", { key: recovery.trim() }).catch((error: unknown) => {
                        if (error instanceof ApiError && error.status === 404)
                          throw new Error("Этот Ключ Veya недействителен или больше не активен. Проверьте сохранённый ключ: замена ключа и восстановление профиля делают предыдущие ключи недействительными.");
                        throw error;
                      });
                      window.dispatchEvent(new Event("veya:social-profile-changed"));
                      setOneTimeKey(data.recoveryKey);
                      if (alive()) {
                        setRecovery("");
                        setAlias(data.profile.alias);
                        setPrivacy(data.profile.privacyMode);
                        setAge(data.profile.ageBand ?? "");
                        setLanguages(data.profile.languages.join(", "));
                        onProfile(data.profile);
                      }
                    });
                  }}
                >
                  <p>
                    Используйте восстановление в новой сессии без профиля Veya. При восстановлении ключ заменяется, а другие сессии профиля отключаются. Сохраните новый ключ. Если вы потеряете и ключ, и сессию браузера, Veya не сможет восстановить ваш профиль.
                  </p>
                  <label className="field">
                    Ключ восстановления
                    <input
                      type="password"
                      autoComplete="off"
                      value={recovery}
                      onChange={(e) => setRecovery(e.target.value)}
                      maxLength={43}
                    />
                  </label>
                  <button
                    className="button button-secondary"
                    disabled={action.busy}
                  >
                    Восстановить профиль
                  </button>
                </form>
              )}
            </>
          )}
          {profile && (
            <>
            <p className="quiet-copy">Замена ключа сразу делает предыдущий ключ недействительным. Сохраните новый ключ, прежде чем уходить. Отзыв ключа отключает восстановление: если после этого вы потеряете сессию браузера, восстановить профиль будет невозможно, пока вы не выпустите новый ключ.</p>
            <div className="social-actions">
              <button
                disabled={action.busy}
                className="button button-secondary"
                onClick={() => {
                  void action.run(async (alive) => {
                    const data = await socialApi<{ recoveryKey: string }>(
                      "/profile/key",
                      "POST",
                      {},
                    );
                    setOneTimeKey(data.recoveryKey);
                    if (alive()) {
                      onProfile({ ...profile, hasRecoveryKey: true });
                    }
                  });
                }}
              >
                Заменить Ключ Veya
              </button>
              <button
                disabled={action.busy || !profile.hasRecoveryKey}
                className="button button-secondary"
                onClick={() => setRevoke(true)}
              >
                Отозвать Ключ Veya
              </button>
              {revoke && (
                <div>
                  <p>
                    Отзыв ключа отключает восстановление до выпуска нового ключа.
                  </p>
                  <button
                    disabled={action.busy}
                    className="button button-secondary"
                    onClick={() => {
                      void action.run(async (alive) => {
                        await socialApi("/profile/key", "DELETE");
                        if (alive()) {
                          setRevoke(false);
                          onProfile({ ...profile, hasRecoveryKey: false });
                        }
                      });
                    }}
                  >
                    Подтвердить отзыв
                  </button>
                  <button
                    className="social-text-button"
                    onClick={() => setRevoke(false)}
                  >
                    Отменить отзыв
                  </button>
                </div>
              )}
            </div>
            </>
          )}
        </>
      )}
      {(profile || restricted) && <>
        <button className="social-text-button" disabled={action.busy} onClick={() => { setDeletion(true); setConfirmation(""); }}>
          Удалить профиль Veya
        </button>
        {deletion && <form className="social-warning" onSubmit={remove}>
          <p>Это действие нельзя отменить. Ваши цели, разрешения, личные сведения профиля, занятия, Ключ Veya, отправленные вами сообщения и переданные сведения будут удалены. В закрытых чатах другие участники сохранят свои сообщения. Материалы для модерации могут быть сохранены. Отдельные планы встреч и информация, которую другие уже скопировали, останутся.</p>
          <label className="field">
            Введите DELETE для подтверждения
            <input autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={action.busy} />
          </label>
          <div className="social-actions">
            <button className="button button-secondary" disabled={action.busy || confirmation !== "DELETE"} type="submit">Удалить профиль навсегда</button>
            <button className="social-text-button" disabled={action.busy} type="button" onClick={() => { setDeletion(false); setConfirmation(""); }}>Отменить удаление</button>
          </div>
        </form>}
      </>}
      <SocialError message={action.error} focusRef={action.errorRef} />
    </section>
  );
}
