"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowIcon } from "@/components/arrow-icon";
import { intentExamples } from "../examples";
import { draftIntentSchema } from "../schema";
import { CreateDetails } from "@/features/entry/components/create-details";
import { useAnalytics, usePageEvent } from "@/lib/analytics/browser";
import { ExampleIcon } from "./example-icon";

export function IntentComposer() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const track = useAnalytics();
  usePageEvent("landing_view");
  const hasSubmitted = useRef(false);

  useEffect(() => {
    if (!draft && hasSubmitted.current) inputRef.current?.focus();
  }, [draft]);

  function submitIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = draftIntentSchema.safeParse(idea);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Try a different idea.");
      inputRef.current?.focus();
      return;
    }
    if (!hasSubmitted.current) track("intent_started");
    hasSubmitted.current = true;
    setError(null);
    setIdea(result.data);
    setDraft(result.data);
  }

  if (draft)
    return <CreateDetails idea={draft} onEdit={() => setDraft(null)} />;

  return (
    <div>
      <form className="composer-card" onSubmit={submitIdea} noValidate>
        <label className="composer-label" htmlFor="intent-idea">
          What do you want to do?
        </label>
        <textarea
          ref={inputRef}
          id="intent-idea"
          name="idea"
          rows={2}
          value={idea}
          placeholder="Let's meet somewhere this week…"
          aria-describedby={
            error ? "composer-hint composer-error" : "composer-hint"
          }
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setIdea(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {error && (
          <p className="form-error" id="composer-error" role="alert">
            {error}
          </p>
        )}
        <div className="composer-bottom">
          <p id="composer-hint">
            An idea is all it takes.
            <br />
            <span>No email or password needed.</span>
          </p>
          <div className="social-composer-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                const result = draftIntentSchema.safeParse(idea);
                if (!result.success) {
                  setError(
                    result.error.issues[0]?.message ?? "Try a different idea.",
                  );
                  inputRef.current?.focus();
                  return;
                }
                try {
                  sessionStorage.setItem("veya.social.draft", result.data);
                } catch {
                  setError(
                    "Your browser could not save this draft. Try again.",
                  );
                  inputRef.current?.focus();
                  return;
                }
                setError(null);
                router.push("/seek/new");
              }}
            >
              Find compatible people <ArrowIcon />
            </button>
            <button className="button button-secondary" type="submit">
              Make it happen <ArrowIcon />
            </button>
          </div>
        </div>
      </form>
      <p className="quiet-copy">Find compatible people starts an activity and a private request. Make it happen creates an invitation for people you already know.</p>
      <div className="examples" aria-label="Try an idea">
        <p>A little inspiration</p>
        <div className="example-buttons">
          {intentExamples.map((example) => (
            <button
              key={example.label}
              type="button"
              className="example-button"
              onClick={() => {
                setIdea(example.idea);
                setError(null);
                inputRef.current?.focus();
              }}
            >
              <ExampleIcon kind={example.kind} />
              {example.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
