import { expect, it, vi, afterEach } from "vitest";
import type { Database } from "@/lib/db/types";
import { processGoalJobs } from "@/features/goals/worker";
import { processGoalWindow } from "@/features/goals/background";
vi.mock("@/features/goals/worker", () => ({ processGoalJobs: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
});
const empty = { claimed: 0, completed: 0, retried: 0, failed: 0 };
function database(pending: boolean) {
  return {
    query: vi.fn().mockResolvedValue({
      rows: pending ? [{ ready: true }] : [],
      rowCount: pending ? 1 : 0,
    }),
  } as unknown as Database;
}
it("continues durable steps and short external waits, then stops when only approval remains", async () => {
  vi.mocked(processGoalJobs)
    .mockResolvedValueOnce({ ...empty, claimed: 1, completed: 1 })
    .mockResolvedValueOnce({ ...empty, claimed: 1, completed: 1 })
    .mockResolvedValue(empty);
  const db = database(false);
  const result = await processGoalWindow(db, { pollMs: 1, durationMs: 1000 });
  expect(result.completed).toBe(2);
  expect(processGoalJobs).toHaveBeenCalledTimes(3);
});
it("waits for a persisted near-term event without a browser, but caps each invocation", async () => {
  vi.mocked(processGoalJobs).mockResolvedValue(empty);
  const result = await processGoalWindow(database(true), {
    pollMs: 1,
    durationMs: 15,
  });
  expect(result.completed).toBe(0);
  expect(processGoalJobs).toHaveBeenCalled();
});
it("starts no work after cancellation", async () => {
  vi.mocked(processGoalJobs).mockClear();
  const controller = new AbortController();
  controller.abort();
  await processGoalWindow(database(true), { signal: controller.signal });
  expect(processGoalJobs).not.toHaveBeenCalled();
});
it("keeps retries due after ten seconds within the remaining worker window", async () => {
  vi.mocked(processGoalJobs)
    .mockResolvedValueOnce({ ...empty, claimed: 1, retried: 1 })
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce({ ...empty, claimed: 1, completed: 1 })
    .mockResolvedValue(empty);
  let reads = 0;
  const db = {
    query: vi.fn(async (_sql: string, values?: unknown[]) => {
      reads++;
      const ready = reads === 1 && Number(values?.[0]) >= 10000;
      return { rows: ready ? [{ ready: true }] : [], rowCount: ready ? 1 : 0 };
    }),
  } as unknown as Database;
  const result = await processGoalWindow(db, { durationMs: 20000, pollMs: 1 });
  expect(result).toMatchObject({ retried: 1, completed: 1 });
});
it("does not consume the work batch allowance while waiting for persisted events", async () => {
  let calls=0;
  vi.mocked(processGoalJobs).mockImplementation(async()=> {
    calls++;
    return calls===90?{...empty,claimed:1,completed:1}:empty;
  });
  const db={query:vi.fn(async()=> ({rows:calls<=90?[{ready:true}]:[],rowCount:calls<=90?1:0}))} as unknown as Database;
  expect((await processGoalWindow(db,{durationMs:1000,pollMs:1})).completed).toBe(1);
});
