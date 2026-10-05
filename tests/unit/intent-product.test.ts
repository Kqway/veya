import { z } from "zod";
import { describe, expect, it } from "vitest";
import { interpretConversation, resolveWallClock } from "@/features/intent-product/parser";
import { rankCompatible } from "@/features/discovery/engine";
import type { SeekingCandidate } from "@/features/discovery/types";
import { compatibleAttributes } from "@/features/intent-product/compatibility";
import { defaultPreferences, interpretInputSchema, interpretationSchema, preferencesSchema, searchDraftSchema, offerSchema, roomSchema, roomMessageSchema } from "@/features/intent-product/schema";
const base = { timezone: "Europe/Moscow", referenceDate: "2027-02-01" };
const parse = (text: string, extra = {}) => interpretConversation({ ...base, text, ...extra });
function draft(text = "Нужен пятый в доту сегодня вечером") {
  const result = parse(text);
  if (result.kind !== "draft") throw new Error(`Expected draft, got ${result.kind}`);
  return result.draft;
}
describe("strict intent contract", () => {
  it("rejects foreign identifiers, unbounded text, invalid zones and invalid calendar days", () => {
    expect(interpretInputSchema.safeParse({ ...base, text: "дота", candidateId: "secret" }).success).toBe(false);
    expect(interpretInputSchema.safeParse({ ...base, text: "x".repeat(501) }).success).toBe(false);
    expect(interpretInputSchema.safeParse({ ...base, text: "дота", timezone: "Invalid/Zone" }).success).toBe(false);
    expect(interpretInputSchema.safeParse({ ...base, text: "дота", referenceDate: "2027-02-30" }).success).toBe(false);
  });
  it("permits existing 60-character public aliases while rejecting private nested DTO identifiers", () => {
    const room = { publicKey: "r".repeat(24), activityLabel: "Dota 2", status: "ready", capacity: 5, joinedCount: 5, externalCount: 3, isOwner: true, members: [{ publicKey: "m".repeat(24), alias: "я".repeat(60), avatarSeed: "seed", isMine: true }], planSlug: null };
    expect(roomSchema.safeParse(room).success).toBe(true);
    expect(roomSchema.safeParse({ ...room, members: [{ ...room.members[0], profileId: "private" }] }).success).toBe(false);
    const message = { publicKey: "m".repeat(24), text: "Привет", createdAt: "2027-02-01T20:00:00Z", isMine: true, identity: { alias: "я".repeat(60), avatarSeed: "seed" } };
    expect(roomMessageSchema.safeParse(message).success).toBe(true);
    expect(roomMessageSchema.safeParse({ ...message, identity: { ...message.identity, globalId: "private" } }).success).toBe(false);
  });
  it("validates capacity, per-activity attributes and strict nested DTOs", () => {
    const d = draft();
    expect(searchDraftSchema.safeParse({ ...d, existingPeople: 12 }).success).toBe(false);
    expect(searchDraftSchema.safeParse({ ...d, attributes: { home: "private" } }).success).toBe(false);
    expect(searchDraftSchema.safeParse({ ...d, seeking: { ...d.seeking, activityKey: "gym" }, attributes: { rank: "divine" } }).success).toBe(false);
    expect(searchDraftSchema.safeParse({ ...d, seeking: { ...d.seeking, activityKey: "custom" }, attributes: {} }).success).toBe(true);
    expect(preferencesSchema.safeParse({ ...defaultPreferences(), activities: [{ activityKey: "gym", attributes: { rank: "divine" }, enabled: true }] }).success).toBe(false);
    expect(offerSchema.safeParse({ profileId: "secret" }).success).toBe(false);
    expect(roomSchema.safeParse({ profileId: "secret" }).success).toBe(false);
    expect(roomMessageSchema.safeParse({ text: "x".repeat(2001) }).success).toBe(false);
  });
});
describe("deterministic conversational interpretation", () => {
  it("creates a Dota fifth-player evening intent with four existing people", () => {
    const d = draft();
    expect(d).toMatchObject({ existingPeople: 4, neededPeople: 1, attributes: {}, timezone: "Europe/Moscow", seeking: { activityKey: "dota2", activityLabel: "Dota 2", interactionMode: "online", format: "group", groupSize: 5, city: null } });
    expect(d.seeking.availability).toEqual([{ startAt: "2027-02-01T15:00:00.000Z", endAt: "2027-02-01T20:00:00.000Z" }]);
    expect(interpretationSchema.safeParse(parse("Нужен пятый в доту сегодня вечером")).success).toBe(true);
  });
  it("keeps generic Dota group size unspecified so a fifth-player search can match it", () => {
    const owner = draft();
    const player = draft("Дота сегодня вечером");
    expect(player.seeking.groupSize).toBeNull();
    const candidate = (id: string, d: typeof owner): SeekingCandidate => {
      const s = d.seeking;
      return { id, profileId: id, status: "active", expiresAt: "2027-02-02T20:00:00Z", ageBand: "25–34", activityKey: s.activityKey, activityLabel: s.activityLabel, interactionMode: s.interactionMode, format: s.format, city: s.city, area: s.area, availability: s.availability, skill: s.skill, languages: s.languages, tags: s.tags, desiredAgeBands: s.desiredAgeBands, groupSize: s.groupSize };
    };
    expect(rankCompatible(candidate("owner", owner), [candidate("player", player)], { now: "2027-02-01T12:00:00Z" })).toHaveLength(1);
  });
  it("normalizes English Dota role/rank and tomorrow windows", () => {
    expect(draft("Need a fifth for Dota 2 tomorrow evening, support, divine ranked")).toMatchObject({ existingPeople: 4, attributes: { role: "support", rank: "divine", mode: "ranked" }, seeking: { activityKey: "dota2", availability: [{ startAt: "2027-02-02T15:00:00.000Z", endAt: "2027-02-02T20:00:00.000Z" }] } });
  });
  it("asks a single time question without fabricating availability, then city", () => {
    const first = parse("Хочу в зал");
    expect(first).toMatchObject({ kind: "clarification", draft: null, question: { field: "time" }, partialDraft: { seeking: { activityKey: "gym", city: null } } });
    if (first.kind !== "clarification") return;
    const second = parse("Завтра вечером", { partialDraft: first.partialDraft });
    expect(second).toMatchObject({ kind: "clarification", question: { field: "city" }, draft: null });
    if (second.kind !== "clarification") return;
    const third = parse("Москва", { partialDraft: second.partialDraft });
    expect(third).toMatchObject({ kind: "draft", draft: { seeking: { city: "Moscow", area: null, activityKey: "gym" } } });
  });
  it("accepts a bounded coarse city answer without treating an address as a city", () => {
    const first = parse("В зал завтра вечером");
    if (first.kind !== "clarification") throw new Error("Expected city question");
    expect(parse("Казань", { partialDraft: first.partialDraft })).toMatchObject({ kind: "draft", draft: { seeking: { city: "Казань", area: null } } });
    expect(parse("Улица Тверская", { partialDraft: first.partialDraft })).toMatchObject({ kind: "clarification", question: { field: "city" } });
    expect(parse("Не знаю", { partialDraft: first.partialDraft })).toMatchObject({ kind: "clarification", question: { field: "city" } });
  });
  it("preserves explicit city before asking time", () => {
    const first = parse("В зал в Москве");
    expect(first).toMatchObject({ kind: "clarification", question: { field: "time" }, partialDraft: { seeking: { city: "Moscow" } } });
    if (first.kind !== "clarification") return;
    expect(parse("Завтра вечером", { partialDraft: first.partialDraft })).toMatchObject({ kind: "draft", draft: { seeking: { city: "Moscow" } } });
  });
  it("preserves time and city while clarifying activity", () => {
    const first = parse("Хочу чем-нибудь заняться завтра вечером в Москве");
    expect(first).toMatchObject({ kind: "clarification", question: { field: "activity" }, partialDraft: { seeking: { city: "Moscow", availability: [{ startAt: "2027-02-02T15:00:00.000Z" }] } } });
    if (first.kind !== "clarification") return;
    expect(parse("В зал", { partialDraft: first.partialDraft })).toMatchObject({ kind: "draft", draft: { seeking: { activityKey: "gym", city: "Moscow" } } });
  });
  it("uses the existing general catalogue and clarifies ambiguous/embedded activity words", () => {
    expect(parse("Шахматы завтра вечером в Москве")).toMatchObject({ kind: "draft", draft: { seeking: { activityKey: "chess" }, attributes: {} } });
    expect(parse("Дота или кино завтра вечером")).toMatchObject({ kind: "clarification", question: { field: "activity" } });
    expect(parse("Хочу дотянуться до цели сегодня вечером")).toMatchObject({ kind: "clarification", question: { field: "activity" } });
  });
  it("clarifies unknown activity rather than inventing it", () => {
    expect(parse("Хочу куда-нибудь сегодня вечером")).toMatchObject({ kind: "clarification", question: { field: "activity" }, draft: null });
  });
  it("merges followup support and minimum rank into the own draft", () => {
    expect(parse("Нужен саппорт не ниже легенды", { draft: draft() })).toMatchObject({ kind: "draft", draft: { attributes: { role: "support", minRank: "legend" }, existingPeople: 4 } });
  });
  it("does not copy private street/address into city or area", () => {
    expect(parse("В зал завтра вечером по адресу улица Тверская 10")).toMatchObject({ kind: "clarification", question: { field: "city" }, partialDraft: { seeking: { city: null, area: null } } });
  });
  it("supports stop and explicit bounded extension commands", () => {
    expect(parse("Останови поиск")).toMatchObject({ kind: "command", command: { type: "stop" } });
    expect(parse("Продли на 2 часа")).toMatchObject({ kind: "command", command: { type: "extend", minutes: 120 } });
    expect(parse("extend 30 minutes")).toMatchObject({ kind: "command", command: { type: "extend", minutes: 30 } });
  });
  it("rejects out-of-bounds extensions through strict command validation", () => {
    expect(() => parse("Продли на 25 часов")).toThrow(z.ZodError);
    expect(() => parse("Extend 0 minutes")).toThrow(z.ZodError);
  });
  it("returns explicit visible preference proposals for offers, quiet hours and activity rules", () => {
    expect(parse("Не присылай предложения")).toMatchObject({ kind: "preference", preference: { type: "offers", offersEnabled: false } });
    expect(parse("Тихие часы с 22 до 8")).toMatchObject({ kind: "preference", preference: { type: "quiet_hours", quietHours: { startHour: 22, endHour: 8 } } });
    expect(parse("Для доты предпочитаю саппорта не ниже легенды")).toMatchObject({ kind: "preference", preference: { type: "activity", activityKey: "dota2", attributes: { role: "support", minRank: "legend" } } });
  });
  it("replaces rather than appends raw followup text and drops attributes on activity change", () => {
    const result = parse("В зал завтра вечером в Москве", { draft: draft("Дота сегодня вечером саппорт divine") });
    expect(result).toMatchObject({ kind: "draft", draft: { attributes: {}, seeking: { rawText: "В зал завтра вечером в Москве", activityKey: "gym", interactionMode: "in_person" } } });
  });
  it("rejects past reference windows by clarifying time", () => {
    expect(parse("Дота вчера вечером")).toMatchObject({ kind: "clarification", question: { field: "time" } });
    expect(parse("Дота 2026-02-01 вечером")).toMatchObject({ kind: "clarification", question: { field: "time" } });
  });
  it("resolves explicit wall clocks with DST roundtrip and rejects gaps/folds", () => {
    expect(resolveWallClock("2027-03-28", 18, 0, "Europe/Berlin")).toBe("2027-03-28T16:00:00.000Z");
    expect(resolveWallClock("2027-03-28", 2, 30, "Europe/Berlin")).toBeNull();
    expect(resolveWallClock("2027-10-31", 2, 30, "Europe/Berlin")).toBeNull();
    expect(parse("Dota 2027-03-28 from 02:30 to 04:00", { timezone: "Europe/Berlin", referenceDate: "2027-03-28" })).toMatchObject({ kind: "clarification", question: { field: "time" } });
  });
});
describe("deterministic attribute compatibility", () => {
  it("enforces known minimum Dota rank and rejects unknown rank", () => {
    expect(compatibleAttributes("dota2", { minRank: "legend" }, { rank: "ancient" })).toBe(true);
    expect(compatibleAttributes("dota2", { minRank: "legend" }, { rank: "archon" })).toBe(false);
    expect(compatibleAttributes("dota2", { minRank: "legend" }, {})).toBe(false);
    expect(compatibleAttributes("dota2", { role: "support" }, { role: "carry" })).toBe(false);
  });
  it("uses controlled activity fields and accepts empty unknown activities", () => {
    expect(compatibleAttributes("study", { subject: "math", level: "advanced" }, { subject: "Math", level: "advanced" })).toBe(true);
    expect(compatibleAttributes("gym", { experience: "beginner" }, { experience: "advanced" })).toBe(false);
    expect(compatibleAttributes("custom", {}, {})).toBe(true);
    expect(compatibleAttributes("custom", { role: "support" }, {})).toBe(false);
  });
});

describe("ordinary conversational followups", () => {
 it("stops and extends through the phrases shown in the product brief", () => {
  expect(parse("Уже нашли, заканчивай")).toMatchObject({kind:"command",command:{type:"stop"}});
  expect(parse("Ищи ещё час")).toMatchObject({kind:"command",command:{type:"extend",minutes:60}});
 });
 it("removes an earlier rank restriction when the actor explicitly permits any rank", () => {
  const previous=draft("Дота завтра вечером, не ниже Legend");
  const next=parse("Можно любой рейтинг",{draft:previous});
  expect(next).toMatchObject({kind:"draft",draft:{attributes:{rank:"any",minRank:"any"}}});
  if(next.kind==="draft")expect(next.draft.attributes).not.toMatchObject({mode:"ranked"});
 });
 it("understands visible quiet-hour and habitual activity preferences",()=>{
  expect(parse("Не присылай игровые предложения после полуночи")).toMatchObject({kind:"preference",preference:{type:"quiet_hours",quietHours:{startHour:0,endHour:8}}});
  expect(parse("В Dota я обычно играю support")).toMatchObject({kind:"preference",preference:{type:"activity",activityKey:"dota2",attributes:{role:"support"}}});
 });
});

it('keeps today evening usable after it starts and clarifies once its remaining window is over',()=>{
 const own={text:'Дота сегодня вечером',timezone:'Europe/Moscow',referenceDate:'2027-02-01'};
 const during=interpretConversation(own,new Date('2027-02-01T17:20:00Z'));
 expect(during).toMatchObject({kind:'draft',draft:{seeking:{availability:[{startAt:'2027-02-01T17:30:00.000Z',endAt:'2027-02-01T20:00:00.000Z'}]}}});
 expect(interpretConversation(own,new Date('2027-02-01T20:01:00Z'))).toMatchObject({kind:'clarification',question:{field:'time'}});
});
