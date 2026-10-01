import "server-only";
import { getServerEnv } from "@/lib/config/server";
import { getDatabase } from "@/lib/db";
import { FixedWindowLimiter, type RateAction, type RequestLimiter } from "./rate-limit";
import { PostgresLimiter } from "./postgres-limiter";
/** Lazy configuration: builds never open PostgreSQL or freeze runtime host settings. */
export class RuntimeRequestLimiter implements RequestLimiter {
  private readonly memory = new FixedWindowLimiter();
  private shared: PostgresLimiter | undefined;
  async check(action:RateAction,token?:string) {
    const config = getServerEnv();
    return (config.RATE_LIMIT_BACKEND === "postgres" ? (this.shared ??= new PostgresLimiter(getDatabase)) : this.memory).check(action,token);
  }
}
