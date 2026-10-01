import { afterEach, describe, expect, it, vi } from "vitest";
import * as database from "@/lib/db";

const initialEnv = { ...process.env };
afterEach(() => { process.env = { ...initialEnv }; vi.restoreAllMocks(); });

describe("deployment endpoints and logging", () => {
  it("reports liveness without parsing credentials or connecting", async () => {
    process.env.DATABASE_URL = "invalid-secret-connection";
    const { GET } = await import("@/app/api/health/route");
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns a generic unavailable response when the database is unconfigured", async () => {
    delete process.env.DATABASE_URL;
    const { GET } = await import("@/app/api/ready/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
  it("strips content, identifiers and raw errors from structured operational logs", async () => {
    const { logOperationalEvent } = await import("@/lib/logging/server");
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    logOperationalEvent("database_unavailable", { durationMs: 42, count: 3, body: "private body", profileId: "private-id", error: new Error("secret postgres://password") });
    const line = String(output.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: "database_unavailable", durationMs: 42, count: 3 });
    for (const value of ["private", "secret", "password", "body", "profileId", "error"]) expect(line).not.toContain(value);
  });
  it("supports idempotent shutdown before any pool is created", async () => {
    expect(typeof database.closeDatabase).toBe("function");
    await database.closeDatabase();
    await database.closeDatabase();
  });
});
