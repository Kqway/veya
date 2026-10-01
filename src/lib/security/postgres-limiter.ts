import "server-only";
import { createHash } from "node:crypto";
import type { Database } from "@/lib/db/types";
import { ratePolicies, type Policy, type RateAction, type RateDecision, type RequestLimiter } from "./rate-limit";
type Bucket = {used:number;reset_at:Date};
/** Shared authoritative admission. Uses the database clock and bounded, hashed buckets. */
export class PostgresLimiter implements RequestLimiter {
  private readonly policies: Record<RateAction,Policy>;
  private readonly maxBuckets: number;
  constructor(private readonly db: () => Database, options: {policies?:Partial<Record<RateAction,Policy>>;maxBuckets?:number} = {}) {
    this.policies = {...ratePolicies,...options.policies};
    this.maxBuckets = options.maxBuckets ?? 4096;
    if (!Number.isInteger(this.maxBuckets) || this.maxBuckets < 1 || this.maxBuckets > 4096 || Object.values(this.policies).some((p) => !Number.isInteger(p.global) || p.global < 1 || p.global > 1000000 || !Number.isInteger(p.guest) || p.guest < 1 || p.guest > 1000000)) throw new Error("Invalid rate limits.");
  }
  async check(action: RateAction, token?:string): Promise<RateDecision> {
    try {
      return await this.db().transaction(async (tx) => {
        // One short lock bounds total storage and makes global/guest admission atomic.
        // This is deliberately sized for an initial controlled release, not a large fleet.
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('veya-shared-limiter',0))");
        const clock = await tx.query<{now:Date}>("SELECT clock_timestamp() AS now");
        const now = clock.rows[0]!.now.getTime();
        await tx.query("DELETE FROM rate_limit_buckets WHERE (action,bucket_key) IN (SELECT action,bucket_key FROM rate_limit_buckets WHERE reset_at<=clock_timestamp() ORDER BY reset_at LIMIT 100)");
        const global = await tx.query<Bucket>("SELECT used,reset_at FROM rate_limit_buckets WHERE action=$1 AND bucket_key='global'",[action]);
        const hash = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? createHash("sha256").update(token).digest("hex") : null;
        const guest = hash ? await tx.query<Bucket>("SELECT used,reset_at FROM rate_limit_buckets WHERE action=$1 AND bucket_key=$2",[action,hash]) : null;
        const day = action === "profileCreate" ? await tx.query<Bucket>("SELECT used,reset_at FROM rate_limit_buckets WHERE action=$1 AND bucket_key='global-day'",[action]) : null;
        const deny = (at:number):RateDecision => ({allowed:false,retryAfterSeconds:Math.max(1,Math.ceil((at-now)/1000))});
        const active = (row:Bucket|undefined) => row && row.reset_at.getTime()>now ? row : undefined;
        const g = active(global.rows[0]), u = active(guest?.rows[0]), d = active(day?.rows[0]);
        if (g && g.used>=this.policies[action].global) return deny(g.reset_at.getTime());
        if (u && u.used>=this.policies[action].guest) return deny(u.reset_at.getTime());
        if (d && d.used>=500) return deny(d.reset_at.getTime());
        const count = await tx.query<{count:string}>("SELECT count(*) FROM rate_limit_buckets WHERE reset_at>clock_timestamp()");
        const needed = (!g?1:0) + (hash && !u?1:0) + (action === "profileCreate" && !d?1:0);
        if (Number(count.rows[0]!.count)+needed>this.maxBuckets) return deny(now+60000);
        async function take(key:string,row:Bucket|undefined,window:number) {
          await tx.query("INSERT INTO rate_limit_buckets(action,bucket_key,used,reset_at) VALUES($1,$2,$3,$4) ON CONFLICT(action,bucket_key) DO UPDATE SET used=EXCLUDED.used,reset_at=EXCLUDED.reset_at",[action,key,(row?.used??0)+1,row?.reset_at??new Date(now+window)]);
        }
        await take("global",g,60000);
        if (hash) await take(hash,u,60000);
        if (action === "profileCreate") await take("global-day",d,86400000);
        return {allowed:true,retryAfterSeconds:0};
      });
    } catch {
      // Never silently fall back to per-process quotas when the shared store fails.
      return {allowed:false,retryAfterSeconds:1};
    }
  }
}
