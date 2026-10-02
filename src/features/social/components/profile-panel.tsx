"use client";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/features/entry/client";
import {
  ageBands,
  csv,
  ensureGuest,
  privacyModes,
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
    [languages, setLanguages] = useState(profile?.languages.join(", ") ?? "");
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
          "Confirm that you are 18 or older to create a profile.",
        );
      if (!alias.trim() || alias.trim().length > 60)
        throw new Error("Choose an alias up to 60 characters.");
      const parsed = csv(languages, 5, 20);
      if (parsed.some((v) => !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(v)))
        throw new Error("Use language codes, for example en, es or fr.");
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
      if (data.deleted !== true) throw new Error("Deletion was not confirmed. Please try again.");
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
        setLanguages("");
        setPrivacy("PRIVATE");
        setRecovery("");
        setShowRecover(false);
        setNotice("Your social profile was deleted.");
        onProfile(null);
      }
    });
  }
  return (
    <section className="social-card" aria-label="Your social profile">
      <h2>{restricted ? "Your profile is unavailable" : profile ? "Your profile" : "Choose how you appear"}</h2>
      {restricted && <p>You can still delete the Veya profile connected to this browser session.</p>}
      {!profile && !restricted && <p>Create an 18+ social profile, save your Veya Key, then add an activity. No email or password is needed.</p>}
      {profile && <Person identity={profile} />}
      <PrivacyCopy />
      {notice && <p role="status">{notice}</p>}
      {!oneTimeKey && !restricted && (
        <>
          <form onSubmit={save} noValidate>
            <fieldset disabled={action.busy}>
              <label className="field">
                Alias
                <input
                  maxLength={60}
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                Privacy
                <select
                  value={privacy}
                  onChange={(e) => setPrivacy(e.target.value as PrivacyMode)}
                >
                  {privacyModes.map((mode) => (
                    <option key={mode}>{mode}</option>
                  ))}
                </select>
              </label>
              <p className="quiet-copy">
                Open shares your chosen alias and allowed coarse details.
                Private uses your chosen pseudonym. Incognito uses pair aliases.
              </p>
              <label className="field">
                Age band (optional)
                <select value={age} onChange={(e) => setAge(e.target.value)}>
                  <option value="">Prefer not to say</option>
                  {ageBands.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Profile languages (optional)
                <input
                  value={languages}
                  onChange={(e) => setLanguages(e.target.value)}
                  maxLength={104}
                  placeholder="en, es"
                />
              </label>
              {!profile && (
                <label className="social-check">
                  <input
                    type="checkbox"
                    checked={adult}
                    onChange={(e) => setAdult(e.target.checked)}
                  />
                  I am 18 or older
                </label>
              )}
              <button className="button button-primary" type="submit">
                {action.busy
                  ? "Saving…"
                  : profile
                    ? "Save profile"
                    : "Create profile"}
              </button>
            </fieldset>
          </form>
          {!profile && (
            <>
              <button
                className="social-text-button"
                onClick={() => setShowRecover(!showRecover)}
              >
                Recover with a Veya Key
              </button>
              {showRecover && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action.run(async (alive) => {
                      setNotice("");
                      if (!/^[A-Za-z0-9_-]{43}$/.test(recovery.trim()))
                        throw new Error("Enter your 43-character Veya Key.");
                      await ensureGuest();
                      if (!alive()) return;
                      const data = await socialApi<{
                        profile: Profile;
                        recoveryKey: string;
                      }>("/profile/recover", "POST", { key: recovery.trim() }).catch((error: unknown) => {
                        if (error instanceof ApiError && error.status === 404)
                          throw new Error("This Veya Key is invalid or no longer active. Check the saved key; rotation and recovery invalidate previous keys.");
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
                    Use this from a new session without a social profile.
                    Recovery rotates your key and disconnects your other social
                    sessions. Save the replacement key. If both your key and browser
                    session are lost, Veya cannot recover your profile.
                  </p>
                  <label className="field">
                    Recovery key
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
                    Recover profile
                  </button>
                </form>
              )}
            </>
          )}
          {profile && (
            <>
            <p className="quiet-copy">Rotation immediately invalidates your previous key. Save the replacement before leaving. Revoking a key disables recovery; losing your browser session afterward is unrecoverable until you issue a new key.</p>
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
                Rotate Veya Key
              </button>
              <button
                disabled={action.busy || !profile.hasRecoveryKey}
                className="button button-secondary"
                onClick={() => setRevoke(true)}
              >
                Revoke Veya Key
              </button>
              {revoke && (
                <div>
                  <p>
                    Revoking your key disables recovery until you rotate a new
                    key.
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
                    Confirm revoke
                  </button>
                  <button
                    className="social-text-button"
                    onClick={() => setRevoke(false)}
                  >
                    Cancel revoke
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
          Delete Veya profile
        </button>
        {deletion && <form className="social-warning" onSubmit={remove}>
          <p>This cannot be undone. Your personal profile details, activities, Veya Key, messages you sent and details you shared will be removed. Other participants retain their own messages in closed conversations. Moderation evidence may be retained. Separate coordination plans and information others already copied remain.</p>
          <label className="field">
            Type DELETE to confirm
            <input autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={action.busy} />
          </label>
          <div className="social-actions">
            <button className="button button-secondary" disabled={action.busy || confirmation !== "DELETE"} type="submit">Permanently delete profile</button>
            <button className="social-text-button" disabled={action.busy} type="button" onClick={() => { setDeletion(false); setConfirmation(""); }}>Cancel deletion</button>
          </div>
        </form>}
      </>}
      <SocialError message={action.error} focusRef={action.errorRef} />
    </section>
  );
}
