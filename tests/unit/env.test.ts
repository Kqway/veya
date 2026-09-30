import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/config/env";

describe("server environment", () => {
  it("boots locally without database or AI credentials", () => {
    expect(parseServerEnv({})).toEqual({
      NODE_ENV: "development",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      AI_PROVIDER: "mock",
      ANALYTICS_ENABLED: false,
    });
  });

  it("accepts empty optional settings from the example file", () => {
    expect(
      parseServerEnv({ DATABASE_URL: "", OPENAI_API_KEY: "" }).DATABASE_URL,
    ).toBeUndefined();
  });

  it("parses explicit false as false, rather than a truthy string", () => {
    expect(
      parseServerEnv({ ANALYTICS_ENABLED: "false" }).ANALYTICS_ENABLED,
    ).toBe(false);
    expect(
      parseServerEnv({ ANALYTICS_ENABLED: "true" }).ANALYTICS_ENABLED,
    ).toBe(true);
  });

  it("accepts PostgreSQL URLs without requiring a connection", () => {
    const url = "postgresql://veya:local-password@localhost:5432/veya";
    expect(parseServerEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it.each([
    "ftp://example.com",
    "not-a-url",
    "https://user:secret@example.com",
    "https://example.com/path",
    "https://example.com?key=secret",
  ])("rejects an invalid public origin %s", (origin) => {
    expect(() => parseServerEnv({ NEXT_PUBLIC_APP_URL: origin })).toThrow(
      "NEXT_PUBLIC_APP_URL",
    );
  });

  it("redacts the value of an invalid database setting", () => {
    const secret = "mysql://admin:do-not-display-this@localhost/db";
    let message = "";
    try {
      parseServerEnv({ DATABASE_URL: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain(secret);
    expect(message).not.toContain("do-not-display-this");
  });

  it("reports the field for a malformed database URI", () => {
    expect(() =>
      parseServerEnv({ DATABASE_URL: "private-value-without-a-scheme" }),
    ).toThrow("DATABASE_URL");
  });

  it("accepts optional OpenAI with a missing key and a bounded model name", () => {
    expect(parseServerEnv({ AI_PROVIDER: "openai" }).AI_PROVIDER).toBe(
      "openai",
    );
    expect(
      parseServerEnv({ AI_PROVIDER: "openai", OPENAI_MODEL: "gpt-4.1-mini" })
        .OPENAI_MODEL,
    ).toBe("gpt-4.1-mini");
    expect(() => parseServerEnv({ OPENAI_MODEL: "https://evil.test" })).toThrow(
      "OPENAI_MODEL",
    );
  });

  it("rejects unsupported provider and misspelled boolean settings", () => {
    expect(() => parseServerEnv({ AI_PROVIDER: "unknown" })).toThrow(
      "AI_PROVIDER",
    );
    expect(() => parseServerEnv({ ANALYTICS_ENABLED: "flase" })).toThrow(
      "ANALYTICS_ENABLED",
    );
  });
});
