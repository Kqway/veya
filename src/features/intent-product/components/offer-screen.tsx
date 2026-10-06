"use client";
import Link from "next/link";
import { useState } from "react";
import { useSocialAction } from "@/features/social/client";
import type { OfferDTO } from "../schema";
import { OfferCard } from "./intent-cards";
import { ProductError, ProductRefresh, ProductShell, ProductUnavailable, productApi, useProductData } from "./product-common";
const offerLabels = { accepted: "Вы приняли предложение", declined: "Вы отклонили предложение", expired: "Время предложения истекло", cancelled: "Поиск остановлен или компания уже собралась", pending: "Предложение ждёт вашего ответа" };
export function OfferScreen({ offerKey }: { offerKey: string }) {
  const state = useProductData(async () => (await productApi<{ offer: OfferDTO }>(`/offers/${encodeURIComponent(offerKey)}`)).offer, null as OfferDTO | null);
  const action = useSocialAction();
  const [notice, setNotice] = useState("");
  return <ProductShell title="Есть общее намерение" eyebrow="Veya / предложение"><ProductError message={action.error ?? state.error} retry={state.error ? state.refresh : undefined} />{!state.loaded && <p role="status">Загружаем предложение…</p>}{state.loaded && !state.profile && !state.error && <ProductUnavailable restricted={state.restricted} />}{notice && <p role="status" className="intent-notice">{notice}</p>}{state.profile && state.data && <>{state.data.status === "pending" ? <OfferCard offer={state.data} busy={action.busy} onRespond={(response) => { void action.run(async (alive) => { const { offer } = await productApi<{ offer: OfferDTO }>(`/offers/${encodeURIComponent(offerKey)}/respond`, "POST", { action: response }); if (alive()) { state.setData(offer); setNotice(response === "accept" ? "Вы в деле." : "Предложение отклонено."); } }); }} /> : <div className="intent-card"><h2>{state.data.activityLabel}</h2><p>{offerLabels[state.data.status]}</p><p>{state.data.timeHint}</p>{state.data.status === "accepted" && !state.data.roomKey && <p className="intent-muted">Комната откроется, когда компания соберётся. Это не подтверждение участия во встрече.</p>}{state.data.roomKey && <Link className="intent-button" href={`/room/${encodeURIComponent(state.data.roomKey)}`}>Открыть комнату</Link>}</div>}<ProductRefresh refresh={state.refresh} live={state.live} /></>}<Link className="intent-text-button" href="/network">На экран «Сейчас»</Link></ProductShell>;
}
