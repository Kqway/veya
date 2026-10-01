"use client";
import { useState, type FormEvent } from "react";
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
}: {
  profile: Profile | null;
  onProfile: (profile: Profile) => void;
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
    [revoke, setRevoke] = useState(false);
  const action = useSocialAction();
  const { key: oneTimeKey, showKey: setOneTimeKey } = useRecoveryKey();
  function save(event: FormEvent) {
    event.preventDefault();
    void action.run(async (alive) => {
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
  return (
    <section className="social-card" aria-label="Your social profile">
      <h2>{profile ? "Your profile" : "Choose how you appear"}</h2>
      {profile && <Person identity={profile} />}
      <PrivacyCopy />
      {!oneTimeKey && (
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
                      if (!/^[A-Za-z0-9_-]{43}$/.test(recovery.trim()))
                        throw new Error("Enter your 43-character Veya Key.");
                      await ensureGuest();
                      if (!alive()) return;
                      const data = await socialApi<{
                        profile: Profile;
                        recoveryKey: string;
                      }>("/profile/recover", "POST", { key: recovery.trim() });
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
                    sessions.
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
          )}
        </>
      )}
      <SocialError message={action.error} focusRef={action.errorRef} />
    </section>
  );
}
