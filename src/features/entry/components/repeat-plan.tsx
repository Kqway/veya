"use client";
import Link from "next/link";
import { useAnalytics } from "@/lib/analytics/browser";
export function RepeatPlan({ surface }: { surface: "invite" | "result" }) {
  const track = useAnalytics();
  return (
    <section className="repeat-plan" aria-label="Ваш следующий план">
      <p className="eyebrow">Хорошие встречи хочется повторять</p>
      <h2>
        {surface === "invite"
          ? "Есть идея для встречи?"
          : "Запланируйте ещё одну встречу с друзьями."}
      </h2>
      <p className="quiet-copy">
        Новая идея. Всё тот же простой способ собрать друзей.
      </p>
      <Link
        className="button button-secondary"
        href="/"
        onClick={() => track("new_intent_from_invite", surface)}
      >
        Создать свой план
      </Link>
    </section>
  );
}
