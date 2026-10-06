"use client";
import { useState } from "react";
import type { RoomDTO } from "../schema";
import { RoomCard } from "./intent-cards";
import { ProductError, ProductRefresh, ProductShell, ProductUnavailable, productApi, useProductData } from "./product-common";
const readRooms = async () => (await productApi<{ rooms: RoomDTO[] }>("/rooms")).rooms;
export function PeopleScreen() {
  const state = useProductData(readRooms, [] as RoomDTO[]);
  const [history, setHistory] = useState(false);
  const current = state.data.filter((room) => !["completed", "archived", "closed"].includes(room.status));
  const past = state.data.filter((room) => ["completed", "archived", "closed"].includes(room.status));
  return <ProductShell title="Ваша компания" eyebrow="Veya / люди"><p className="intent-intro">Люди здесь появляются вокруг общего дела.</p><ProductError message={state.error} retry={state.refresh} />{!state.loaded && <p role="status">Загружаем комнаты…</p>}{state.loaded && !state.profile && !state.error && <ProductUnavailable restricted={state.restricted} />}{state.profile && <>{current.length ? <div className="intent-section">{current.map((room) => <RoomCard key={room.publicKey} room={room} />)}</div> : <div className="intent-empty"><h2>Пока нет активных комнат</h2><p>Когда участники примут предложение и компания соберётся, здесь откроется временная комната.</p></div>}{past.length > 0 && <><button className="intent-text-button" aria-expanded={history} onClick={() => setHistory(!history)}>{history ? "Скрыть завершённые комнаты" : "Завершённые комнаты"}</button>{history && <div className="intent-section">{past.map((room) => <RoomCard key={room.publicKey} room={room} />)}</div>}</>}<ProductRefresh refresh={state.refresh} live={state.live} /></>}</ProductShell>;
}
