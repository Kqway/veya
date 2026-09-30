"use client";
import Link from "next/link";
import { useAnalytics } from "@/lib/analytics/browser";
export function RepeatPlan({ surface }: { surface: "invite" | "result" }) {
  const track = useAnalytics();
  return (
    <section className="repeat-plan" aria-label="Your next plan">
      <p className="eyebrow">Good times lead to more good times</p>
      <h2>
        {surface === "invite"
          ? "Have something you want to do?"
          : "Start another plan with your friends."}
      </h2>
      <p className="quiet-copy">
        A new idea. The same easy way to bring your people together.
      </p>
      <Link
        className="button button-secondary"
        href="/"
        onClick={() => track("new_intent_from_invite", surface)}
      >
        Create your own plan
      </Link>
    </section>
  );
}
