import { describe, expect, it } from "vitest";
import { normalizeActivity, normalizeActivityKey } from "@/features/discovery/activity-normalization";

describe("explicit owned-text activity catalogue", () => {
  it.each(["шахматы", "поиграть в шахматы", "chess", " CHESS ", "шахматишки", "сыграть партию", "Хочу шахмат завтра", "Play chess online"])("recognizes chess: %s", (text) => {
    expect(normalizeActivity(text)).toEqual({ key: "chess", label: "Chess" });
  });
  it.each(["football", "футбол", "поиграть в футбол"])("recognizes football independently: %s", (text) => {
    expect(normalizeActivity(text)).toEqual({ key: "football", label: "Football" });
  });
  it.each(["", "games", "party", "play a game", "studious", "English", "coffeehouse", "chessboard", "шахматист", "footballer", "заломить"])("does not infer an activity from ambiguity or substrings: %s", (text) => {
    expect(normalizeActivity(text)).toBeNull();
  });
  it("does not choose between two explicit distinct activities", () => {
    expect(normalizeActivity("chess or football")).toBeNull();
  });
  it.each([["Шахматы", "chess"], ["шахматишки", "chess"], ["поиграть в шахматы", "chess"], [" board games ", "board-games"], [" chess-club ", "chess-club"], ["Custom-Activity", "custom-activity"]])("canonicalizes only full key aliases: %s", (value, key) => {
    expect(normalizeActivityKey(value)).toBe(key);
  });
});

describe("closed beta bilingual activity vocabulary", () => {
  it.each([
    ["chess", "шахматы", "chess", "Chess"],
    ["gym", "тренажёрный зал", "gym", "Gym"],
    ["running", "пробежка", "running", "Running"],
    ["walking", "прогулка", "walk", "Walking"],
    ["movies", "кино", "movies", "Movies"],
    ["gaming", "видеоигры", "gaming", "Gaming"],
    ["study", "учёба", "study", "Study"],
    ["programming", "программирование", "programming", "Programming"],
    ["football", "футбол", "football", "Football"],
    ["basketball", "баскетбол", "basketball", "Basketball"],
    ["coffee", "кофе", "coffee", "Coffee"],
    ["language practice", "языковая практика", "language-practice", "Language practice"],
  ])("normalizes EN %s and RU %s to the same key", (en, ru, key, label) => {
    for (const text of [en, ru, `Looking for ${en} together`, `Хочу ${ru} завтра`]) {
      expect(normalizeActivity(text)).toEqual({ key, label });
    }
    expect(normalizeActivityKey(en)).toBe(key);
    expect(normalizeActivityKey(ru)).toBe(key);
  });
  it.each([
    ["бегать", "running"], ["смотреть фильмы", "movies"], ["computer games", "gaming"],
    ["кодинг", "programming"], ["soccer", "football"], ["practice languages", "language-practice"],
    ["практика языков", "language-practice"], ["English practice", "english-practice"],
    ["Study calculus", "calculus"], ["study programming", "programming"],
  ])("keeps a single explicit activity for %s", (text, key) => {
    expect(normalizeActivity(text)?.key).toBe(key);
  });
  it.each(["running or basketball", "кино или видеоигры", "study and programming", "language practice and chess", "moviegoer", "basketballer", "программист", "runningclub", "gymnastics"])("keeps ambiguous or embedded terms manual: %s", (text) => {
    expect(normalizeActivity(text)).toBeNull();
  });
  it("preserves unknown manual keys and does not collapse custom keys into known activities", () => {
    expect(normalizeActivity("Pottery with friends")).toBeNull();
    for (const key of ["pottery", "running-club", "study-group", "language-practice-club"]) {
      expect(normalizeActivityKey(` ${key.toUpperCase()} `)).toBe(key);
    }
  });
});
