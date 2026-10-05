"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ensureGuest, socialApi, useSocialAction, type Profile } from "@/features/social/client";
import { useRecoveryKey } from "@/features/social/components/recovery-key-provider";
import { ProductError } from "./product-common";
export function MinimalOnboarding({ onCreated }: { onCreated: () => Promise<void> }) {
  const [alias, setAlias] = useState("");
  const [adult, setAdult] = useState(false);
  const [policy, setPolicy] = useState(false);
  const action = useSocialAction();
  const recovery = useRecoveryKey();
  function create(event: FormEvent) {
    event.preventDefault();
    void action.run(async (alive) => {
      if (!alias.trim() || !adult || !policy) throw new Error("Укажите псевдоним и подтвердите возраст и правила приватности.");
      await ensureGuest();
      if (!alive()) return;
      const result = await socialApi<{ profile: Profile; recoveryKey?: string }>("/profile", "POST", { alias: alias.trim(), privacyMode: "PRIVATE", adultConfirmed: true, languages: ["ru"], ageBand: null });
      if (!alive()) return;
      if (result.recoveryKey) recovery.showKey(result.recoveryKey);
      window.dispatchEvent(new Event("veya:social-profile-changed"));
      await onCreated();
    });
  }
  return <section className="intent-card intent-onboarding" aria-label="Начать с приватным профилем"><h2>Как к вам обращаться?</h2><p>Достаточно псевдонима. Профиль будет приватным, а контакты вы раскрываете сами.</p><form onSubmit={create}><fieldset disabled={action.busy}><label className="intent-field">Псевдоним<input autoComplete="off" maxLength={60} value={alias} onChange={(event) => setAlias(event.target.value)} required /></label><label className="intent-check"><input type="checkbox" checked={adult} onChange={(event) => setAdult(event.target.checked)} />Мне исполнилось 18 лет</label><label className="intent-check"><input type="checkbox" checked={policy} onChange={(event) => setPolicy(event.target.checked)} />Я понимаю правила приватности: не передаю чужие контакты и сам решаю, что раскрыть о себе</label><button className="intent-button" type="submit">Продолжить</button></fieldset></form><ProductError message={action.error} /><Link className="intent-text-button" href="/profile">У меня уже есть Ключ Intavro</Link></section>;
}
