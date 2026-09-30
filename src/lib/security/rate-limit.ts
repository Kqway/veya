import "server-only";
import { createHash } from "node:crypto";
export type RateAction =
  | "read"
  | "write"
  | "session"
  | "create"
  | "join"
  | "ai"
  | "analytics"
  | "preview"
  | "image";
export type RateDecision = { allowed: boolean; retryAfterSeconds: number };
export interface RequestLimiter {
  check(
    action: RateAction,
    token?: string,
  ): RateDecision | Promise<RateDecision>;
}
type Policy = { global: number; guest: number };
const policies: Record<RateAction, Policy> = {
  read: { global: 1200, guest: 120 },
  write: { global: 300, guest: 30 },
  session: { global: 300, guest: 30 },
  create: { global: 100, guest: 10 },
  join: { global: 200, guest: 30 },
  ai: { global: 20, guest: 6 },
  analytics: { global: 600, guest: 60 },
  preview: { global: 300, guest: 30 },
  image: { global: 120, guest: 20 },
};
type Bucket = { count: number; resetAt: number };
/** Process-local guard. A multi-instance host must supply a shared adapter/gateway. */
export class FixedWindowLimiter implements RequestLimiter {
  private readonly globals = new Map<RateAction, Bucket>();
  private readonly guests = new Map<string, Bucket>();
  private readonly config: Record<RateAction, Policy>;
  private readonly clock: () => number;
  private readonly maxEntries: number;
  private lastNow = 0;
  constructor(
    options: {
      clock?: () => number;
      maxEntries?: number;
      policies?: Partial<Record<RateAction, Policy>>;
    } = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.maxEntries = options.maxEntries ?? 4096;
    this.config = { ...policies, ...options.policies };
    if (
      !Number.isInteger(this.maxEntries) ||
      this.maxEntries < 1 ||
      this.maxEntries > 4096 ||
      Object.values(this.config).some(
        (p) =>
          !Number.isInteger(p.global) ||
          p.global < 1 ||
          !Number.isInteger(p.guest) ||
          p.guest < 1,
      )
    )
      throw new Error("Invalid rate limits.");
  }
  check(action: RateAction, token?: string): RateDecision {
    const now = Math.max(this.lastNow, this.clock());
    this.lastNow = now;
    for (const [key, bucket] of this.guests)
      if (bucket.resetAt <= now) this.guests.delete(key);
    const policy = this.config[action];
    let global = this.globals.get(action);
    if (!global || global.resetAt <= now) {
      global = { count: 0, resetAt: now + 60000 };
      this.globals.set(action, global);
    }
    const denied = (resetAt: number): RateDecision => ({
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    });
    if (global.count >= policy.global) return denied(global.resetAt);
    const key =
      token && /^[A-Za-z0-9_-]{43}$/.test(token)
        ? `${action}:${createHash("sha256").update(token).digest("hex")}`
        : null;
    let guest = key ? this.guests.get(key) : undefined;
    if (guest && guest.count >= policy.guest) return denied(guest.resetAt);
    if (key && !guest) {
      if (this.guests.size >= this.maxEntries)
        return denied(
          Math.min(...[...this.guests.values()].map((b) => b.resetAt)),
        );
      guest = { count: 0, resetAt: now + 60000 };
      this.guests.set(key, guest);
    }
    global.count++;
    if (guest) guest.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
const scope = globalThis as typeof globalThis & {
  veyaRequestLimiter?: FixedWindowLimiter;
};
export const runtimeLimiter =
  scope.veyaRequestLimiter ?? new FixedWindowLimiter();
scope.veyaRequestLimiter = runtimeLimiter;
