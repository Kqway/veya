import "server-only";
import type { DatabaseExecutor, Database } from "@/lib/db/types";
import { opaqueKey } from "@/features/social/pairs";
import { publishSocialEvent } from "@/features/realtime/events";
import { enqueueNotification } from "@/features/notifications/service";
import { fail } from "@/features/social/errors";
import type {
  GoalDTO,
  GoalSpec,
  GoalStatus,
  Currency,
  GoalEventDTO,
  GoalApprovalDTO,
  GoalArtifactDTO,
} from "./schema";
import { planNext } from "./planner";
import { toolRegistry, type ToolName } from "./tools";
import { MockArtifactStorage } from "./storage";
export interface GoalRow {
  id: string;
  public_key: string;
  profile_id: string;
  title: string;
  raw_text: string;
  status: GoalStatus;
  spec: GoalSpec;
  currency: Currency;
  target_amount_minor: string;
  next_tool: ToolName;
  cycle: number;
  revision: number;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
}
export async function ownedGoal(
  tx: DatabaseExecutor,
  owner: string,
  key: string,
  lock = false,
) {
  return (
    (
      await tx.query<GoalRow>(
        `SELECT * FROM agent_goals WHERE profile_id=$1 AND public_key=$2${lock ? " FOR UPDATE" : ""}`,
        [owner, key],
      )
    ).rows[0] ?? fail("NOT_FOUND")
  );
}
export async function confirmedAmount(
  tx: DatabaseExecutor,
  id: string,
): Promise<number> {
  return Number(
    (
      await tx.query<{ total: string }>(
        `SELECT COALESCE(sum(p.amount_minor),0) total FROM agent_payment_events p JOIN agent_deals d ON d.id=p.deal_id AND d.goal_id=p.goal_id JOIN agent_goals g ON g.id=p.goal_id WHERE p.goal_id=$1 AND p.invoice_key=d.invoice_key AND p.amount_minor=d.amount_minor AND p.currency=d.currency AND p.currency=g.currency AND d.status='paid'`,
        [id],
      )
    ).rows[0]!.total,
  );
}
export async function event(
  tx: DatabaseExecutor,
  g: GoalRow,
  type: string,
  description: string,
  dedupe: string,
  evidenceRef: string | null = null,
) {
  await tx.query(
    "INSERT INTO agent_events(public_key,goal_id,type,description,evidence_ref,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(goal_id,dedupe_key) DO NOTHING",
    [opaqueKey(), g.id, type, description, evidenceRef, dedupe],
  );
  await publishSocialEvent(tx, [g.profile_id], { topic: "goals" });
  if (["approval", "completed", "blocker"].includes(type))
    await enqueueNotification(tx, {
      recipientProfileId: g.profile_id,
      type:
        type === "approval"
          ? "GOAL_APPROVAL"
          : type === "completed"
            ? "GOAL_RESULT"
            : "GOAL_BLOCKER",
      dedupeKey: "goal:" + g.public_key + ":" + dedupe,
    });
}
export async function goalDTO(
  tx: DatabaseExecutor,
  g: GoalRow,
): Promise<GoalDTO> {
  const events = (
    await tx.query<{
      public_key: string;
      type: string;
      description: string;
      evidence_ref: string | null;
      created_at: Date;
    }>(
      "SELECT * FROM agent_events WHERE goal_id=$1 ORDER BY id DESC LIMIT 100",
      [g.id],
    )
  ).rows.map((r) => ({
    publicKey: r.public_key,
    type: r.type,
    description: r.description,
    evidenceRef: r.evidence_ref,
    createdAt: r.created_at.toISOString(),
  }));
  const artifacts = (
    await tx.query<{
      public_key: string;
      kind: GoalArtifactDTO["kind"];
      title: string;
      media_type: string;
      byte_size: number;
      checksum: string;
      verified: boolean;
      created_at: Date;
    }>(
      "SELECT * FROM agent_artifacts WHERE goal_id=$1 ORDER BY created_at DESC LIMIT 100",
      [g.id],
    )
  ).rows.map((r) => ({
    publicKey: r.public_key,
    kind: r.kind,
    title: r.title,
    mediaType: r.media_type,
    byteSize: r.byte_size,
    checksum: r.checksum,
    verified: r.verified,
    createdAt: r.created_at.toISOString(),
  }));
  const approvals = (
    await tx.query<{
      public_key: string;
      status: GoalApprovalDTO["status"];
      amount_minor: string;
      currency: Currency;
      expires_at: Date;
      created_at: Date;
    }>(
      "SELECT * FROM agent_approvals WHERE goal_id=$1 ORDER BY created_at DESC LIMIT 100",
      [g.id],
    )
  ).rows.map((r) => ({
    publicKey: r.public_key,
    action: "invoice",
    description: "Выставить демонстрационный счёт за проверенный документ",
    status:
      r.status === "pending" && r.expires_at.getTime() <= Date.now()
        ? ("expired" as const)
        : r.status,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    expiresAt: r.expires_at.toISOString(),
    createdAt: r.created_at.toISOString(),
  }));
  const deals = (
    await tx.query<{
      public_key: string;
      title: string;
      status: string;
      amount_minor: string;
      currency: Currency;
      revision: number;
    }>(
      "SELECT * FROM agent_deals WHERE goal_id=$1 ORDER BY cycle DESC LIMIT 100",
      [g.id],
    )
  ).rows.map((r) => ({
    publicKey: r.public_key,
    title: r.title,
    status: r.status,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    revision: r.revision,
  }));
  const terminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(g.status);
  return {
    publicKey: g.public_key,
    title: g.title,
    rawText: g.raw_text,
    status: g.status,
    environment: "demo",
    spec: g.spec,
    confirmedAmountMinor: await confirmedAmount(tx, g.id),
    currency: g.currency,
    currentAction:
      g.failure_code === "CAPABILITY_UNAVAILABLE"
        ? "Для этой цели пока нет доступной способности."
        : g.failure_code === "COMMUNICATION_LIMIT"
          ? "Ожидаем обновления дневного лимита сообщений."
          : g.failure_code === "CONNECTOR_DISABLED"
            ? "Для продолжения нужно подключение."
            : g.failure_code === "SEEKING_REQUIRED"
              ? "Для поиска нужны ваше объявление и доступное время."
              : g.failure_code === "INTERACTION_REQUIRED"
                ? "Совместимые предложения найдены. Договорённость требует вашего участия."
                : g.failure_code === "NO_COMPATIBLE_PEOPLE"
                  ? "Совместимых предложений пока нет."
                  : g.status === "PAUSED"
                    ? "Выполнение приостановлено."
                    : g.status === "FAILED"
                      ? "Не удалось продолжить выполнение."
                      : g.status === "CANCELLED"
                        ? "Цель остановлена."
                        : g.status === "COMPLETED"
                          ? "Цель достигнута."
                          : toolRegistry[g.next_tool].description,
    nextActions:
      terminal || g.status === "PAUSED"
        ? []
        : planNext(g.next_tool, g.revision)
            .slice(1)
            .map((s) => s.description),
    createdAt: g.created_at.toISOString(),
    updatedAt: g.updated_at.toISOString(),
    events,
    artifacts,
    approvals,
    deals,
    failureCode: g.failure_code,
  };
}
export async function eraseGoalProfile(tx: DatabaseExecutor, profile: string) {
  await tx.query(
    "INSERT INTO agent_artifact_erasure(goal_id) SELECT id FROM agent_goals WHERE profile_id=$1 ON CONFLICT DO NOTHING",
    [profile],
  );
  await tx.query("DELETE FROM agent_goals WHERE profile_id=$1", [profile]);
  for (const table of [
    "agent_connector_accounts",
    "agent_autonomy_preferences",
    "agent_communication_usage",
  ])
    await tx.query(`DELETE FROM ${table} WHERE profile_id=$1`, [profile]);
}
export async function cleanupGoalArtifacts(db: Database, limit = 100) {
  const rows = (
    await db.query<{ goal_id: string }>(
      "SELECT goal_id FROM agent_artifact_erasure ORDER BY created_at LIMIT $1",
      [limit],
    )
  ).rows;
  for (const r of rows) {
    await new MockArtifactStorage().erase(r.goal_id);
    await db.query("DELETE FROM agent_artifact_erasure WHERE goal_id=$1", [
      r.goal_id,
    ]);
  }
  return rows.length;
}
export async function goalActivity(
  tx: DatabaseExecutor,
  owner: string,
): Promise<GoalEventDTO[]> {
  return (
    await tx.query<{
      public_key: string;
      goal_key: string;
      type: string;
      description: string;
      evidence_ref: string | null;
      created_at: Date;
    }>(
      "SELECT e.*,g.public_key goal_key FROM agent_events e JOIN agent_goals g ON g.id=e.goal_id WHERE g.profile_id=$1 ORDER BY e.id DESC LIMIT 100",
      [owner],
    )
  ).rows.map((r) => ({
    publicKey: r.public_key,
    goalKey: r.goal_key,
    type: r.type,
    description: r.description,
    evidenceRef: r.evidence_ref,
    createdAt: r.created_at.toISOString(),
  }));
}
