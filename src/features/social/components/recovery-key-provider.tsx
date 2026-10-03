"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
type RecoveryState = { key: string | null; showKey: (key: string) => void; clearKey: () => void };
const RecoveryContext = createContext<RecoveryState | null>(null);

/** Memory only, above Next route boundaries. Secrets never enter storage or analytics. */
export function RecoveryKeyProvider({ children }: { children: ReactNode }) {
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const copyAttempt = useRef(0);
  function clearKey() {
    copyAttempt.current++;
    setOneTimeKey(null);
    setDiscard(false);
    setCopyStatus("");
  }
  useEffect(() => {
    if (!oneTimeKey) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [oneTimeKey]);

  return <RecoveryContext.Provider value={{ key: oneTimeKey, clearKey, showKey: (key) => { copyAttempt.current++; setCopyStatus(""); setDiscard(false); setOneTimeKey(key); } }}>
    {oneTimeKey && <section className="social-card social-recovery-banner" aria-label="Сохраните ключ восстановления">
        <div className="social-key">
          <h3>Сохраните Ключ Intavro в надёжном месте</h3>
          <p>
            Этот ключ показывается только один раз. Сохраните его в месте, доступном только вам, чтобы восстановить профиль. Любой, у кого есть ключ, может получить контроль над вашим профилем Intavro. Восстановление заменяет ключ и отключает другие сессии профиля, но не переносит права организатора ваших прежних планов.
          </p>
          <p className="social-warning">
            Вы ещё не сохранили ключ. Если вы потеряете и ключ, и сессию браузера, восстановить профиль будет невозможно. Intavro не сможет показать ключ повторно.
          </p>
          <label className="field">
            Ключ Intavro
            <input
              readOnly
              value={oneTimeKey}
              autoComplete="off"
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>
          <div className="social-actions">
            <button
              className="button button-secondary"
              onClick={async () => {
                const attempt = ++copyAttempt.current;
                try {
                  if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
                  await navigator.clipboard.writeText(oneTimeKey);
                  if (copyAttempt.current === attempt) setCopyStatus("Ключ скопирован. Сохраните его в надёжном месте и подтвердите это ниже.");
                } catch {
                  if (copyAttempt.current === attempt) setCopyStatus("Выделите ключ и скопируйте его вручную, затем сохраните в надёжном месте.");
                }
              }}
            >
              Скопировать Ключ Intavro
            </button>
            <button
              className="button button-primary"
              onClick={clearKey}
            >
              Ключ сохранён
            </button>
            <button
              className="button button-secondary"
              onClick={() => setDiscard(true)}
            >
              Закрыть без сохранения
            </button>
          </div>
          {copyStatus && <p role="status">{copyStatus}</p>}
          {discard && (
            <div role="alert">
              <p>
                Если закрыть ключ без сохранения, восстановление профиля может стать невозможным. Показать ключ повторно нельзя.
              </p>
              <button
                className="button button-secondary"
                onClick={clearKey}
              >
                Закрыть ключ без сохранения
              </button>
            </div>
          )}
        </div>
    </section>}
    {children}
  </RecoveryContext.Provider>;
}
export function useRecoveryKey() {
  const context = useContext(RecoveryContext);
  if (!context) throw new Error("Recovery provider is required.");
  return context;
}
