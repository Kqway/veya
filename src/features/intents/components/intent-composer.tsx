"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowIcon } from "@/components/arrow-icon";
import { intentExamples } from "../examples";
import { draftIntentSchema } from "../schema";
import { ExampleIcon } from "./example-icon";

export function IntentComposer() {
  const [idea, setIdea] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLHeadingElement>(null);
  const hasSubmitted = useRef(false);

  useEffect(() => {
    if (draft) previewRef.current?.focus();
    else if (hasSubmitted.current) inputRef.current?.focus();
  }, [draft]);

  function submitIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = draftIntentSchema.safeParse(idea);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Try a different idea.");
      inputRef.current?.focus();
      return;
    }
    hasSubmitted.current = true;
    setError(null);
    setIdea(result.data);
    setDraft(result.data);
  }

  if (draft) {
    return (
      <section className="composer-card draft-preview" aria-label="Your idea preview">
        <div className="draft-mark" aria-hidden="true"><ArrowIcon /></div>
        <p className="eyebrow">Your next plan</p>
        <h2 ref={previewRef} tabIndex={-1} className="draft-title">{draft}</h2>
        <p className="draft-copy">One idea worth getting together for.</p>
        <button type="button" className="button button-secondary" onClick={() => setDraft(null)}>
          Edit your idea <ArrowIcon />
        </button>
        <p className="draft-note">Invites are coming soon. Your idea stays here while you explore.</p>
      </section>
    );
  }

  return (
    <div>
      <form className="composer-card" onSubmit={submitIdea} noValidate>
        <label className="composer-label" htmlFor="intent-idea">What do you want to do?</label>
        <textarea
          ref={inputRef}
          id="intent-idea"
          name="idea"
          rows={2}
          value={idea}
          placeholder="Let's meet somewhere this week…"
          aria-describedby={error ? "composer-hint composer-error" : "composer-hint"}
          aria-invalid={Boolean(error)}
          onChange={(event) => { setIdea(event.target.value); setError(null); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {error && <p className="form-error" id="composer-error" role="alert">{error}</p>}
        <div className="composer-bottom">
          <p id="composer-hint">An idea is all it takes.<br /><span>No account needed.</span></p>
          <button className="button button-primary" type="submit">
            Make it happen <ArrowIcon />
          </button>
        </div>
      </form>
      <div className="examples" aria-label="Try an idea">
        <p>A little inspiration</p>
        <div className="example-buttons">
          {intentExamples.map((example) => (
            <button key={example.label} type="button" className="example-button" onClick={() => {
              setIdea(example.idea);
              setError(null);
              inputRef.current?.focus();
            }}>
              <ExampleIcon kind={example.kind} />{example.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
