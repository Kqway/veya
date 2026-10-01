"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
type RecoveryState = { key: string | null; showKey: (key: string) => void };
const RecoveryContext = createContext<RecoveryState | null>(null);

/** Memory only, above Next route boundaries. Secrets never enter storage or analytics. */
export function RecoveryKeyProvider({ children }: { children: ReactNode }) {
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  useEffect(() => {
    if (!oneTimeKey) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [oneTimeKey]);

  return <RecoveryContext.Provider value={{ key: oneTimeKey, showKey: (key) => { setDiscard(false); setOneTimeKey(key); } }}>
    {oneTimeKey && <section className="social-card social-recovery-banner" aria-label="Save your recovery key">
        <div className="social-key">
          <h3>Save Veya Key privately</h3>
          <p>
            This is shown once. Save it somewhere private to recover your
            profile. Anyone with this key can take control of your social
            profile. Recovery replaces the key and disconnects other social
            sessions; it does not transfer your old plan ownership.
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
              className="button button-primary"
              onClick={() => {
                setOneTimeKey(null);
                setDiscard(false);
              }}
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
          {discard && (
            <div role="alert">
              <p>
                Discarding this key without saving it may prevent recovery. It
                cannot be shown again.
              </p>
              <button
                className="button button-secondary"
                onClick={() => {
                  setOneTimeKey(null);
                  setDiscard(false);
                }}
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
