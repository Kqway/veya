import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase } from "../support/postgres";
import { applyMigrations } from "@/lib/db/migrations";
import { PostgresLimiter } from "@/lib/security/postgres-limiter";

describe("multi-instance shared admission", () => {
  let cluster: Awaited<ReturnType<typeof startTestDatabase>>;
  beforeAll(async () => { cluster = await startTestDatabase(); await applyMigrations(cluster.db); });
  afterAll(async () => { if (cluster) await cluster.stop(); });
  beforeEach(async () => { await cluster.db.query("TRUNCATE rate_limit_buckets"); });
  it("shares guest/global quotas across independent instances and restarts", async () => {
    const options = { policies: { connection: {global:3,guest:2} } };
    const one = new PostgresLimiter(() => cluster.db, options), two = new PostgresLimiter(() => cluster.db, options);
    expect((await one.check("connection", "A".repeat(43))).allowed).toBe(true);
    expect((await two.check("connection", "A".repeat(43))).allowed).toBe(true);
    expect((await one.check("connection", "A".repeat(43))).allowed).toBe(false);
    expect((await two.check("connection", "B".repeat(43))).allowed).toBe(true);
    expect((await new PostgresLimiter(() => cluster.db,options).check("connection", "C".repeat(43))).allowed).toBe(false);
    const buckets = await cluster.db.query<{bucket_key:string;used:number}>("SELECT bucket_key,used FROM rate_limit_buckets WHERE action='connection'");
    expect(buckets.rows.find((r) => r.bucket_key === "global")!.used).toBe(3);
    expect(JSON.stringify(buckets.rows)).not.toContain("A".repeat(43));
  });
  it("serializes concurrent global admission from two processes", async () => {
    const options = { policies: { message: {global:5,guest:3} } };
    const one = new PostgresLimiter(() => cluster.db,options), two = new PostgresLimiter(() => cluster.db,options);
    const decisions = await Promise.all(Array.from({length:20},(_,i) => (i%2 ? one : two).check("message", (i%2 ? "A" : "B").repeat(43))));
    expect(decisions.filter((r) => r.allowed)).toHaveLength(5);
    expect(decisions.filter((r) => !r.allowed).every((r) => r.retryAfterSeconds > 0 && r.retryAfterSeconds <= 60)).toBe(true);
  });
  it("bounds anonymous expensive actions and ignores malformed credentials", async () => {
    const limiter = new PostgresLimiter(() => cluster.db,{ policies:{ ai:{global:2,guest:1} } });
    expect((await limiter.check("ai")).allowed).toBe(true);
    expect((await limiter.check("ai", "untrusted-credential")).allowed).toBe(true);
    expect((await limiter.check("ai", "other-invalid")).allowed).toBe(false);
    expect((await cluster.db.query("SELECT * FROM rate_limit_buckets")).rows).toHaveLength(1);
  });
  it("resets expired buckets using the database clock and caps active bucket storage", async () => {
    const limiter = new PostgresLimiter(() => cluster.db,{ policies:{ read:{global:100,guest:1} },maxBuckets:2 });
    expect((await limiter.check("read", "A".repeat(43))).allowed).toBe(true);
    expect((await limiter.check("read", "B".repeat(43))).allowed).toBe(false);
    await cluster.db.query("UPDATE rate_limit_buckets SET reset_at=clock_timestamp()-interval '1 second'");
    expect((await limiter.check("read", "B".repeat(43))).allowed).toBe(true);
    expect((await cluster.db.query("SELECT * FROM rate_limit_buckets WHERE reset_at>clock_timestamp()")).rows.length).toBeLessThanOrEqual(2);
  });
  it("enforces a durable daily profile-creation ceiling as well as minute quotas", async () => {
    await cluster.db.query("INSERT INTO rate_limit_buckets(action,bucket_key,used,reset_at) VALUES('profileCreate','global-day',500,clock_timestamp()+interval '12 hours')");
    expect((await new PostgresLimiter(() => cluster.db).check("profileCreate", "A".repeat(43))).allowed).toBe(false);
  });
  it("fails closed without exposing provider errors or falling back to process-local admission", async () => {
    const limiter = new PostgresLimiter(() => { throw new Error("postgresql://private-secret@example.invalid"); });
    expect(await limiter.check("recovery", "A".repeat(43))).toEqual({allowed:false,retryAfterSeconds:1});
  });
  it("keeps shared rate state inaccessible to a directly granted client role", async () => {
    await cluster.db.query("CREATE ROLE limiter_client");
    await cluster.db.query("GRANT SELECT ON rate_limit_buckets TO limiter_client");
    await new PostgresLimiter(() => cluster.db).check("report", "A".repeat(43));
    await cluster.db.transaction(async (tx) => {
      await tx.query("SET LOCAL ROLE limiter_client");
      expect((await tx.query("SELECT * FROM rate_limit_buckets")).rows).toEqual([]);
    });
  });
});
