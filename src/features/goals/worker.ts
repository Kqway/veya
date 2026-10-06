import { AiTasks } from "@/lib/ai/tasks";
import type { ToolName } from "./tools";
import "server-only";
import { createHash } from "node:crypto";
import type { Database, DatabaseExecutor } from "@/lib/db/types";
import { lockProfiles } from "@/features/social/context";
import { opaqueKey } from "@/features/social/pairs";
import {
  event,
  confirmedAmount,
  cleanupGoalArtifacts,
  type GoalRow,
} from "./repository";
import { toolRegistry } from "./tools";
import { policyDecision } from "./policy";
import { executeRegisteredTool } from "./execution";
import { processPeopleGoal } from "./intent-network-adapter";
import { assertTransition } from "./state";
interface Job {
  id: string;
  goal_id: string;
  profile_id: string;
  lease_key: string;
  attempts: number;
}
async function finish(
  tx: DatabaseExecutor,
  j: Job,
  status: "pending" | "sleeping" | "done" | "failed",
  delay = 0,
) {
  await tx.query(
    `UPDATE agent_jobs SET status=$3,lease_key=NULL,lease_until=NULL,attempts=CASE WHEN $3 IN('pending','sleeping','done') THEN 0 ELSE attempts END,available_at=clock_timestamp()+($4::integer*interval '1 second'),updated_at=clock_timestamp() WHERE id=$1 AND lease_key=$2`,
    [j.id, j.lease_key, status, delay],
  );
}
async function transition(
  tx: DatabaseExecutor,
  g: GoalRow,
  status: GoalRow["status"],
  failure: string | null = null,
) {
  assertTransition(g.status, status);
  await tx.query(
    "UPDATE agent_goals SET status=$2,failure_code=$3,updated_at=clock_timestamp() WHERE id=$1",
    [g.id, status, failure],
  );
  g.status = status;
}
async function tick(
  tx: DatabaseExecutor,
  j: Job,
  signal?: AbortSignal,
  proposed?: ToolName,
): Promise<boolean> {
  const kind = (
    await tx.query<{ spec: { type: string } }>(
      "SELECT spec FROM agent_goals WHERE id=$1",
      [j.goal_id],
    )
  ).rows[0];
  if (kind?.spec.type === "find_people")
    return processPeopleGoal(tx, j, signal);
  await lockProfiles(tx, [j.profile_id]);
  const g = (
    await tx.query<GoalRow>(
      "SELECT * FROM agent_goals WHERE id=$1 FOR UPDATE",
      [j.goal_id],
    )
  ).rows[0];
  const lease = (
    await tx.query<{ valid: boolean }>(
      "SELECT lease_until>clock_timestamp() valid FROM agent_jobs WHERE id=$1 AND lease_key=$2 AND status='processing' FOR UPDATE",
      [j.id, j.lease_key],
    )
  ).rows[0];
  if (!g || !lease?.valid) return false;
  if (signal?.aborted) {
    await finish(tx, j, "pending");
    return false;
  }
  const owner = (
    await tx.query<{ moderation_status: string; deleted_at: Date | null }>(
      "SELECT moderation_status,deleted_at FROM social_profiles WHERE id=$1",
      [j.profile_id],
    )
  ).rows[0];
  if (!owner || owner.deleted_at || owner.moderation_status !== "active") {
    if (!["COMPLETED", "FAILED", "CANCELLED", "PAUSED"].includes(g.status)) {
      await transition(tx, g, "PAUSED", "OWNER_UNAVAILABLE");
      await event(
        tx,
        g,
        "blocker",
        "Выполнение остановлено: профиль недоступен",
        "owner-unavailable",
      );
    }
    await finish(tx, j, "sleeping");
    return true;
  }
  if (
    g.status === "WAITING_APPROVAL" &&
    (
      await tx.query(
        "SELECT id FROM agent_approvals WHERE goal_id=$1 AND status='pending' AND expires_at>clock_timestamp()",
        [g.id],
      )
    ).rows.length === 0
  )
    await transition(tx, g, "ACTIVE");
  if (
    ["PAUSED", "WAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"].includes(
      g.status,
    )
  ) {
    await finish(
      tx,
      j,
      ["COMPLETED", "FAILED", "CANCELLED"].includes(g.status)
        ? "done"
        : "sleeping",
    );
    return true;
  }
  const account = (
    await tx.query<{ enabled: boolean }>(
      "SELECT enabled FROM agent_connector_accounts WHERE profile_id=$1",
      [j.profile_id],
    )
  ).rows[0];
  if (!account?.enabled) {
    await transition(tx, g, "PAUSED", "CONNECTOR_DISABLED");
    await event(
      tx,
      g,
      "blocker",
      "Демонстрационное подключение отключено",
      "disabled:" + opaqueKey(),
    );
    await finish(tx, j, "sleeping");
    return true;
  }
  if (proposed !== g.next_tool) throw new Error("Planner changed after claim");
  if (g.status === "PLANNING" || g.status === "WAITING_EXTERNAL")
    await transition(tx, g, "ACTIVE");
  const amount = Math.min(
    1000000,
    Number(g.target_amount_minor) - (await confirmedAmount(tx, g.id)),
  );
  const input = toolRegistry[g.next_tool].input.parse({
    goalKey: g.public_key,
    cycle: g.cycle,
    revision: g.revision,
    amountMinor: amount,
    currency: g.currency,
  });
  const inputHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex"),
    actionKey =
      g.public_key + ":" + g.cycle + ":" + g.next_tool + ":" + g.revision;
  const step = (
    await tx.query<{ id: string; status: string; input_hash: string }>(
      `INSERT INTO agent_steps(public_key,goal_id,action_key,tool,input,input_hash,revision,status) VALUES($1,$2,$3,$4,$5,$6,$7,'pending') ON CONFLICT(goal_id,action_key) DO UPDATE SET goal_id=EXCLUDED.goal_id RETURNING id,status,input_hash`,
      [
        opaqueKey(),
        g.id,
        actionKey,
        g.next_tool,
        JSON.stringify(input),
        inputHash,
        g.revision,
      ],
    )
  ).rows[0]!;
  if (step.status === "completed" || step.input_hash !== inputHash)
    throw new Error("Stale planner input");
  await tx.query(
    "UPDATE agent_approvals SET status='expired' WHERE step_id=$1 AND status IN('pending','approved') AND (expires_at<=clock_timestamp() OR input_hash<>$2 OR revision<>$3)",
    [step.id, inputHash, g.revision],
  );
  const approved =
    (
      await tx.query(
        `SELECT id FROM agent_approvals WHERE step_id=$1 AND status='approved' AND input_hash=$2 AND revision=$3 AND expires_at>clock_timestamp()`,
        [step.id, inputHash, g.revision],
      )
    ).rows.length > 0;
  const budget = (
    await tx.query<{ communication_limit: number; used: number }>(
      `SELECT p.communication_limit,COALESCE(u.used,0) used FROM agent_autonomy_preferences p LEFT JOIN agent_communication_usage u ON u.profile_id=p.profile_id AND u.day=(clock_timestamp() AT TIME ZONE 'UTC')::date WHERE p.profile_id=$1`,
      [j.profile_id],
    )
  ).rows[0];
  const decision = policyDecision(
    toolRegistry[g.next_tool].risk,
    approved,
    budget?.used ?? 0,
    budget?.communication_limit ?? 5,
  );
  if (decision === "approval") {
    await tx.query(
      `INSERT INTO agent_approvals(public_key,goal_id,step_id,input_hash,revision,status,amount_minor,currency) VALUES($1,$2,$3,$4,$5,'pending',$6,$7) ON CONFLICT DO NOTHING`,
      [opaqueKey(), g.id, step.id, inputHash, g.revision, amount, g.currency],
    );
    await transition(tx, g, "WAITING_APPROVAL");
    await event(
      tx,
      g,
      "approval",
      "Нужно одобрить выставление демонстрационного счёта",
      "approval:" + step.id + ":" + opaqueKey(),
    );
    await finish(tx, j, "sleeping");
    return true;
  }
  if (decision === "wait") {
    await transition(tx, g, "WAITING_EXTERNAL", "COMMUNICATION_LIMIT");
    await event(
      tx,
      g,
      "blocker",
      "Дневной лимит сообщений исчерпан. Продолжим завтра.",
      "budget:" + new Date().toISOString().slice(0, 10),
    );
    await finish(
      tx,
      j,
      "pending",
      Math.max(
        1,
        Math.ceil(
          (Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate() + 1,
          ) -
            Date.now()) /
            1000,
        ),
      ),
    );
    return true;
  }
  if (toolRegistry[g.next_tool].risk === "EXTERNAL_COMMUNICATION")
    await tx.query(
      `INSERT INTO agent_communication_usage(profile_id,day,used) VALUES($1,(clock_timestamp() AT TIME ZONE 'UTC')::date,1) ON CONFLICT(profile_id,day) DO UPDATE SET used=agent_communication_usage.used+1`,
      [j.profile_id],
    );
  const observation = await executeRegisteredTool(
    g.next_tool,
    { tx, goal: g, step: { id: step.id, actionKey } },
    input,
  );
  // Storage is local; every authoritative connector action, observation and next step commits atomically.
  // Recheck expiry after local I/O as well: an expired claim must roll back its effects.
  const stillValid = (
    await tx.query<{ valid: boolean }>(
      "SELECT lease_until>clock_timestamp() valid FROM agent_jobs WHERE id=$1 AND lease_key=$2",
      [j.id, j.lease_key],
    )
  ).rows[0]?.valid;
  if (!stillValid || signal?.aborted) throw new Error("Lease expired");
  await tx.query(
    "UPDATE agent_steps SET status='completed',evidence=$2,completed_at=clock_timestamp() WHERE id=$1",
    [
      step.id,
      JSON.stringify({
        reference: observation.reference,
        description: observation.description,
      }),
    ],
  );
  await event(
    tx,
    g,
    "step",
    observation.description,
    "step:" + actionKey,
    observation.reference,
  );
  const completed =
    observation.paid &&
    (await confirmedAmount(tx, g.id)) >= Number(g.target_amount_minor);
  await tx.query(
    "UPDATE agent_goals SET next_tool=$2,revision=$3,cycle=$4,updated_at=clock_timestamp() WHERE id=$1",
    [
      g.id,
      observation.next,
      observation.paid ? 0 : (observation.revision ?? g.revision),
      g.cycle + (observation.paid ? 1 : 0),
    ],
  );
  await transition(
    tx,
    g,
    completed ? "COMPLETED" : observation.wait ? "WAITING_EXTERNAL" : "ACTIVE",
  );
  if (completed)
    await event(
      tx,
      g,
      "completed",
      "Цель достигнута: демонстрационные оплаты подтверждены провайдером",
      "completed",
    );
  await finish(tx, j, completed ? "done" : "pending", observation.wait ? 1 : 0);
  // Attempts count retries of the next step, not the complete lifetime of a goal.
  if (!completed)
    await tx.query("UPDATE agent_jobs SET attempts=0 WHERE id=$1", [j.id]);
  return true;
}
export async function processGoalJobs(
  db: Database,
  options: {
    limit?: number;
    signal?: AbortSignal;
    planner?: Pick<AiTasks, "planGoal">;
  } = {},
): Promise<{
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
}> {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Use limit 1..100");
  const result = { claimed: 0, completed: 0, retried: 0, failed: 0 };
  if (options.signal?.aborted) return result;
  await cleanupGoalArtifacts(db, limit);
  // Expired final claims are handled under the same profile -> goal -> job lock order.
  const exhausted = (
    await db.query<Job>(
      `SELECT j.*,g.profile_id FROM agent_jobs j JOIN agent_goals g ON g.id=j.goal_id WHERE j.status='processing' AND j.lease_until<=clock_timestamp() AND j.attempts>=5 ORDER BY j.lease_until LIMIT $1`,
      [limit],
    )
  ).rows;
  for (const old of exhausted)
    await db.transaction(async (tx) => {
      await lockProfiles(tx, [old.profile_id]);
      const g = (
        await tx.query<GoalRow>(
          "SELECT * FROM agent_goals WHERE id=$1 FOR UPDATE",
          [old.goal_id],
        )
      ).rows[0];
      const failed = await tx.query(
        `UPDATE agent_jobs SET status='failed',lease_key=NULL,lease_until=NULL,failure_code='RETRY_EXHAUSTED' WHERE id=$1 AND lease_key=$2 AND lease_until<=clock_timestamp() AND attempts>=5`,
        [old.id, old.lease_key],
      );
      if (
        g &&
        failed.rowCount &&
        !["COMPLETED", "FAILED", "CANCELLED"].includes(g.status)
      ) {
        await transition(tx, g, "FAILED", "RETRY_EXHAUSTED");
        await event(
          tx,
          g,
          "blocker",
          "Не удалось завершить шаг после пяти попыток",
          "failed",
        );
        result.failed++;
      }
    });
  const nonce = opaqueKey();
  const jobs = (
    await db.query<Job>(
      `WITH chosen AS(SELECT j.id FROM agent_jobs j WHERE j.attempts<5 AND ((j.status='pending' AND j.available_at<=clock_timestamp()) OR (j.status='processing' AND j.lease_until<=clock_timestamp()) OR (j.status='sleeping' AND EXISTS(SELECT 1 FROM agent_goals g JOIN agent_approvals a ON a.goal_id=g.id WHERE g.id=j.goal_id AND g.status='WAITING_APPROVAL' AND a.status='pending' AND a.expires_at<=clock_timestamp()) AND NOT EXISTS(SELECT 1 FROM agent_approvals a WHERE a.goal_id=j.goal_id AND a.status='pending' AND a.expires_at>clock_timestamp()))) ORDER BY j.available_at,j.id LIMIT $1 FOR UPDATE SKIP LOCKED), claimed AS(UPDATE agent_jobs j SET status='processing',attempts=attempts+1,lease_key=$2,lease_until=clock_timestamp()+interval '5 minutes' FROM chosen WHERE j.id=chosen.id RETURNING j.*) SELECT c.*,g.profile_id FROM claimed c JOIN agent_goals g ON g.id=c.goal_id`,
      [limit, nonce],
    )
  ).rows;
  result.claimed = jobs.length;
  for (const j of jobs) {
    if (options.signal?.aborted) break;
    try {
      const snapshot = (
        await db.query<GoalRow>("SELECT * FROM agent_goals WHERE id=$1", [
          j.goal_id,
        ])
      ).rows[0];
      if (!snapshot) continue;
      const proposal = await (options.planner ?? new AiTasks()).planGoal({
        spec: snapshot.spec,
        next: snapshot.next_tool,
        revision: snapshot.revision,
      });
      if (
        await db.transaction((tx) =>
          tick(tx, j, options.signal, proposal.data.steps[0]!.tool),
        )
      )
        result.completed++;
    } catch {
      await db.transaction(async (tx) => {
        await lockProfiles(tx, [j.profile_id]);
        const g = (
          await tx.query<GoalRow>(
            "SELECT * FROM agent_goals WHERE id=$1 FOR UPDATE",
            [j.goal_id],
          )
        ).rows[0];
        const terminal = j.attempts >= 5;
        const changed = await tx.query(
          `UPDATE agent_jobs SET status=$3,lease_key=NULL,lease_until=NULL,failure_code='STEP_FAILED',available_at=clock_timestamp()+($4::integer*interval '1 second') WHERE id=$1 AND lease_key=$2 AND status='processing'`,
          [
            j.id,
            j.lease_key,
            terminal ? "failed" : "pending",
            Math.min(3600, 5 * 2 ** j.attempts),
          ],
        );
        if (changed.rowCount) {
          result[terminal ? "failed" : "retried"]++;
          if (
            terminal &&
            g &&
            !["COMPLETED", "FAILED", "CANCELLED"].includes(g.status)
          ) {
            await transition(tx, g, "FAILED", "STEP_FAILED");
            await event(
              tx,
              g,
              "blocker",
              "Не удалось выполнить шаг после пяти попыток",
              "failed",
            );
          }
        }
      });
    }
  }
  // Release unstarted claims on shutdown. Nonce prevents overwriting a reclaimed worker.
  if (options.signal?.aborted)
    await db.query(
      "UPDATE agent_jobs SET status='pending',attempts=GREATEST(0,attempts-1),lease_key=NULL,lease_until=NULL WHERE lease_key=$1 AND status='processing'",
      [nonce],
    );
  return result;
}
