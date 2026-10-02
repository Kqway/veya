import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/config/env";

describe("server environment", () => {
  it("boots locally without database or AI credentials", () => {
    expect(parseServerEnv({})).toEqual({
      NODE_ENV: "development",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      DB_POOL_MAX: 5,
      REALTIME_ENABLED: true,
      BETA_SIGNUPS_ENABLED: true,
      BETA_SEEKING_ENABLED: true,
      BETA_READ_ONLY: false,
      RATE_LIMIT_BACKEND: "memory",
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


describe("deployment environment", () => {
  it("defaults to shared limits in production without needing build-time secrets", () => {
    expect(parseServerEnv({ NODE_ENV: "production" }).RATE_LIMIT_BACKEND).toBe("postgres");
    expect(parseServerEnv({ NODE_ENV: "production" }).DATABASE_URL).toBeUndefined();
    expect(parseServerEnv({ NODE_ENV: "production", RATE_LIMIT_BACKEND: "memory" }).RATE_LIMIT_BACKEND).toBe("memory");
  });
  it.each(["0", "21", "1.5", "NaN"])("rejects an unbounded database pool %s", (value) => {
    expect(() => parseServerEnv({ DB_POOL_MAX: value })).toThrow("DB_POOL_MAX");
  });
  it("parses a dedicated session connection and explicit disabled realtime", () => {
    expect(parseServerEnv({ DB_POOL_MAX: "20", REALTIME_DATABASE_URL: "postgres://u:p@localhost/db", REALTIME_ENABLED: "false" })).toMatchObject({ DB_POOL_MAX: 20, REALTIME_ENABLED: false, REALTIME_DATABASE_URL: "postgres://u:p@localhost/db" });
  });
  it("requires HTTPS for remote production origins but permits isolated loopback", () => {
    expect(() => parseServerEnv({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://veya.example" })).toThrow("NEXT_PUBLIC_APP_URL");
    expect(parseServerEnv({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100" }).NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:3100");
  });
  it("rejects TLS verification bypasses and accepts verified transport", () => {
    expect(parseServerEnv({ DATABASE_SSL_MODE: "verify-full" }).DATABASE_SSL_MODE).toBe("verify-full");
    for (const value of ["postgres://u:secret@db.example/db?sslmode=no-verify", "postgres://u:secret@db.example/db?sslmode=require", "postgres://u:secret@db.example/db?sslmode=disable"]) {
      expect(() => parseServerEnv({ NODE_ENV: "production", DATABASE_URL: value })).toThrow("DATABASE_URL");
    }
    expect(() => parseServerEnv({ DATABASE_SSL_MODE: "no-verify" })).toThrow("DATABASE_SSL_MODE");
  });
  it("validates optional moderator credentials without reflecting their value", () => {
    expect(parseServerEnv({ MODERATION_ADMIN_SECRET: "a".repeat(32) }).MODERATION_ADMIN_SECRET).toHaveLength(32);
    expect(() => parseServerEnv({ MODERATION_ADMIN_SECRET: "private weak secret" })).toThrow("MODERATION_ADMIN_SECRET");
  });
  it("disables absent push and rejects partially configured keys", () => {
    expect(parseServerEnv({ PUSH_VAPID_PUBLIC_KEY: "", PUSH_VAPID_PRIVATE_KEY: "", PUSH_VAPID_SUBJECT: "" }).PUSH_VAPID_PUBLIC_KEY).toBeUndefined();
    expect(() => parseServerEnv({ PUSH_VAPID_PUBLIC_KEY: "a".repeat(87) })).toThrow("PUSH_VAPID_PRIVATE_KEY");
    expect(parseServerEnv({ PUSH_VAPID_PUBLIC_KEY: "a".repeat(87), PUSH_VAPID_PRIVATE_KEY: "b".repeat(43), PUSH_VAPID_SUBJECT: "mailto:admin@example.com" }).PUSH_VAPID_SUBJECT).toBe("mailto:admin@example.com");
  });
});


describe("production database transport", () => {
  it.each(["ssl=0", "ssl=false", "sslmode=no-verify", "sslmode=verify-ca&uselibpqcompat=true", "host=db.example&sslmode=disable"])("rejects remote verification bypass %s", (query) => {
    expect(() => parseServerEnv({ NODE_ENV: "production", DATABASE_URL: `postgres://u:private@db.example/db?${query}` })).toThrow("DATABASE_URL");
  });
});

describe('production remote transport defaults',()=>{
 it.each(['DATABASE_URL','REALTIME_DATABASE_URL'])('forces verified TLS for remote %s without flags',field=>{
  const config=parseServerEnv({NODE_ENV:'production',NEXT_PUBLIC_APP_URL:'https://veya.example',[field]:'postgresql://veya:secret@db.example/veya'});
  expect(config.DATABASE_SSL_MODE).toBe('verify-full');
 });
 it.each(['sslmode=verify-full&sslmode=require','ssl=false&ssl=true'])('rejects conflicting transport options %s',query=>{
  expect(()=>parseServerEnv({NODE_ENV:'production',NEXT_PUBLIC_APP_URL:'https://veya.example',DATABASE_URL:`postgresql://veya:secret@db.example/veya?${query}`})).toThrow();
 });
});
it('forces verifiedTLS when repeated host parameters point the driver at a remote server',()=>{
 expect(parseServerEnv({NODE_ENV:'production',DATABASE_URL:'postgresql://user:pass@localhost/db?host=localhost&host=db.example.com'}).DATABASE_SSL_MODE).toBe('verify-full');
 expect(()=>parseServerEnv({NODE_ENV:'production',DATABASE_URL:'postgresql://user:pass@localhost/db?host=localhost&host=db.example.com&sslmode=require'})).toThrow();
});

describe("closed beta environment controls", () => {
  it("defaults to enabled signup/seeking and writable application", () => {
    expect(parseServerEnv({})).toMatchObject({ BETA_SIGNUPS_ENABLED: true, BETA_SEEKING_ENABLED: true, BETA_READ_ONLY: false });
  });
  it("parses operator switches as strict booleans", () => {
    expect(parseServerEnv({ BETA_SIGNUPS_ENABLED: "false", BETA_SEEKING_ENABLED: "false", BETA_READ_ONLY: "true" })).toMatchObject({ BETA_SIGNUPS_ENABLED: false, BETA_SEEKING_ENABLED: false, BETA_READ_ONLY: true });
  });
  it.each(["BETA_SIGNUPS_ENABLED", "BETA_SEEKING_ENABLED", "BETA_READ_ONLY"])("rejects malformed %s without reflecting the supplied value", field => {
    for (const value of ["", "1", "TRUE", "private-operator-value"]) {
      expect(() => parseServerEnv({ [field]: value })).toThrow(field);
      expect(() => parseServerEnv({ [field]: value })).not.toThrow(value || "private-operator-value");
    }
  });
});
