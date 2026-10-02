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
  socialApi,
  useSocialAction,
  type OwnPost,
  type PrivacyMode,
  type Profile,
  type SeekingInput,
  type Suggestion,
} from "../client";
import { PrivacyCopy, SocialError } from "./common";
const empty = {
  rawText: "",
  activityKey: "",
  activityLabel: "",
  interactionMode: "in_person" as SeekingInput["interactionMode"],
  format: "one_to_one" as SeekingInput["format"],
  city: "",
  area: "",
  skill: "any" as SeekingInput["skill"],
  languages: "en",
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
      throw new Error("Choose an expiry within the next 30 days.");
    return date.toISOString();
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void action.run(async (alive) => {
      const expiry = expiresAt();
      validateEntryAvailability(availability, expiry);
      if (availability.length > 14)
        throw new Error("Choose at most 14 time ranges.");
      if (!fields.rawText.trim() || fields.rawText.trim().length > 500)
        throw new Error("Describe your activity in up to 500 characters.");
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.activityKey) ||
        fields.activityKey.length > 40 ||
        !fields.activityLabel.trim() ||
        fields.activityLabel.trim().length > 80
      )
        throw new Error(
          "Add an activity key (lowercase words joined by hyphens) and an activity label.",
        );
      if (fields.interactionMode !== "online" && !fields.city.trim())
        throw new Error("Choose a city for in-person activities.");
      const languages = csv(fields.languages, 5, 20, true);
      if (languages.some((v) => !/^[a-z]{2}(?:-[a-z]{2})?$/.test(v)))
        throw new Error("Use language codes, for example en, es or en-us.");
      const groupSize = fields.groupSize ? Number(fields.groupSize) : null;
      if (
        groupSize !== null &&
        (!Number.isInteger(groupSize) ||
          groupSize < 2 ||
          groupSize > 12 ||
          fields.format === "one_to_one")
      )
        throw new Error(
          "Choose a group size from 2 to 12 for a group activity.",
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
      <h2>Your activity, your terms</h2>
      <p>
        Choose what you want to do and real times you are available. No home
        addresses or precise location. Matching uses your activity, meeting format,
        shared language and overlapping future times.
      </p>
      <fieldset disabled={action.busy}>
        <label className="field">
          What do you want to do?
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
                throw new Error("Describe your activity first.");
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
          Help structure
        </button>
        <p className="quiet-copy">
          Optional assistance. Review suggestions before applying them; you can
          edit every field or fill them manually without AI. Unrecognized activities are welcome.
        </p>
        {suggestion && (
          <section className="social-preview" aria-label="Review suggestion">
            <h3>Suggested structure</h3>
            <dl>
              {Object.entries(suggestion).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                  <dd>
                    {Array.isArray(value)
                      ? value.join(", ") || "None suggested"
                      : (value ?? "None suggested")}
                  </dd>
                </div>
              ))}
            </dl>
            <p>Time hints are advisory. Select your own availability below.</p>
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
                Apply reviewed suggestion
              </button>
              <button
                className="social-text-button"
                type="button"
                onClick={() => setSuggestion(null)}
              >
                Keep my details
              </button>
            </div>
          </section>
        )}
        <p className="quiet-copy">Activity key groups the same activity together. Use a short name such as chess or pottery; join multiple words with hyphens. Activity label is the name people see.</p>
        <div className="social-grid">
          <label className="field">
            Activity key
            <input
              value={fields.activityKey}
              onChange={(e) => set("activityKey", e.target.value)}
              maxLength={40}
              placeholder="chess"
            />
          </label>
          <label className="field">
            Activity label
            <input
              value={fields.activityLabel}
              onChange={(e) => set("activityLabel", e.target.value)}
              maxLength={80}
              placeholder="Chess"
            />
          </label>
          <label className="field">
            Interaction
            <select
              value={fields.interactionMode}
              onChange={(e) =>
                set(
                  "interactionMode",
                  e.target.value as SeekingInput["interactionMode"],
                )
              }
            >
              <option value="in_person">In person</option>
              <option value="online">Online</option>
              <option value="either">Either</option>
            </select>
          </label>
          <label className="field">
            Format
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
              <option value="one_to_one">One to one</option>
              <option value="group">Group</option>
              <option value="either">Either</option>
            </select>
          </label>
          <label className="field">
            City
            <input
              value={fields.city}
              onChange={(e) => set("city", e.target.value)}
              maxLength={60}
            />
          </label>
          <label className="field">
            Coarse area (optional)
            <input
              value={fields.area}
              onChange={(e) => set("area", e.target.value)}
              maxLength={60}
              placeholder="District, not an address"
            />
          </label>
          <label className="field">
            Skill
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
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Languages
            <input
              value={fields.languages}
              onChange={(e) => set("languages", e.target.value)}
              maxLength={104}
              placeholder="en, es"
            />
          </label>
          <label className="field">
            Tags (optional)
            <input
              value={fields.tags}
              onChange={(e) => set("tags", e.target.value)}
              maxLength={334}
              placeholder="casual, outdoors"
            />
          </label>
          <label className="field">
            Group size (optional)
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
            Post privacy
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
                  <option key={p}>{p}</option>
                ))}
            </select>
          </label>
          <label className="field">
            Expires on
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
          Language codes separated by commas, up to 5. Up to 8 tags. Post
          privacy can only be stronger than your profile.
        </p>
        <fieldset className="social-age">
          <legend>Desired age bands (optional)</legend>
          <p className="quiet-copy">
            Leave all unchecked for no restriction. People without a known age
            band cannot meet an age restriction.
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
              setAvailabilityError("Choose at most 14 time ranges.");
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
          Choose 1–14 future time ranges. Your exact times stay private during
          discovery.
        </p>
        <button className="button button-primary" type="submit">
          {action.busy ? "Saving…" : "Create seeking post"}
        </button>
      </fieldset>
      <SocialError message={action.error} focusRef={action.errorRef} />
    </form>
  );
}
