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
    {oneTimeKey && <section className="social-card social-recovery-banner" aria-label="Save your recovery key">
        <div className="social-key">
          <h3>Save Veya Key privately</h3>
          <p>
            This is shown once. Save it somewhere private to recover your
            profile. Anyone with this key can take control of your social
            profile. Recovery replaces the key and disconnects other social
            sessions; it does not transfer your old plan ownership.
          </p>
          <p className="social-warning">
            Your key is not saved yet. If you lose both this key and your browser session,
            your profile cannot be recovered. Veya cannot show the key again.
          </p>
          <label className="field">
            Veya Key
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
                  if (copyAttempt.current === attempt) setCopyStatus("Key copied. Save it privately, then acknowledge below.");
                } catch {
                  if (copyAttempt.current === attempt) setCopyStatus("Select the key and copy it manually, then save it privately.");
                }
              }}
            >
              Copy Veya Key
            </button>
            <button
              className="button button-primary"
              onClick={clearKey}
            >
              I saved my key
            </button>
            <button
              className="button button-secondary"
              onClick={() => setDiscard(true)}
            >
              Discard key
            </button>
          </div>
          {copyStatus && <p role="status">{copyStatus}</p>}
          {discard && (
            <div role="alert">
              <p>
                Discarding this key without saving it may prevent recovery. It
                cannot be shown again.
              </p>
              <button
                className="button button-secondary"
                onClick={clearKey}
              >
                Discard without saving
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
