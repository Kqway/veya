import { describe, expect, it } from "vitest";
import { normalizeActivity, normalizeActivityKey } from "@/features/discovery/activity-normalization";

describe("explicit owned-text activity catalogue", () => {
  it.each(["шахматы", "поиграть в шахматы", "chess", " CHESS ", "шахматишки", "сыграть партию", "Хочу шахмат завтра", "Play chess online"])("recognizes chess: %s", (text) => {
    expect(normalizeActivity(text)).toEqual({ key: "chess", label: "Chess" });
  });
  it.each(["football", "футбол", "поиграть в футбол"])("recognizes football independently: %s", (text) => {
    expect(normalizeActivity(text)).toEqual({ key: "football", label: "Football" });
  });
  it.each(["", "games", "party", "play a game", "study", "English", "coffeehouse", "chessboard", "шахматист", "footballer", "заломить"])("does not infer an activity from ambiguity or substrings: %s", (text) => {
    expect(normalizeActivity(text)).toBeNull();
  });
  it("does not choose between two explicit distinct activities", () => {
    expect(normalizeActivity("chess or football")).toBeNull();
  });
  it.each([["Шахматы", "chess"], ["шахматишки", "chess"], ["поиграть в шахматы", "chess"], [" board games ", "board-games"], [" chess-club ", "chess-club"], ["Custom-Activity", "custom-activity"]])("canonicalizes only full key aliases: %s", (value, key) => {
    expect(normalizeActivityKey(value)).toBe(key);
  });
});
