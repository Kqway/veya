import "server-only";
import type { Database, DatabaseExecutor } from "@/lib/db/types";
import {
  lockProfiles,
  requireProfile,
  reauthorize,
} from "@/features/social/context";
import { parseSocialInput } from "@/features/social/profile-schema";
import { opaqueKey } from "@/features/social/pairs";
import { fail } from "@/features/social/errors";
import {
  createGoalSchema,
  commandSchema,
  approvalSchema,
  connectionSchema,
  autonomySchema,
  keySchema,
  type GoalDTO,
  type ConnectionDTO,
  type AutonomyPolicy,
} from "./schema";
import { interpretGoal } from "./interpreter";
import {
  ownedGoal,
  goalDTO,
  event,
  goalActivity,
  type GoalRow,
} from "./repository";
import { assertTransition, terminalStatuses } from "./state";
import { MockArtifactStorage } from "./storage";
export class GoalService {
  constructor(private readonly db: Database) {}
  private async auth<T>(
    token: string,
    work: (tx: DatabaseExecutor, owner: string) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const p = await requireProfile(tx, token);
      await lockProfiles(tx, [p.id]);
      await reauthorize(tx, token, p.id);
      return work(tx, p.id);
    });
  }
  async create(token: string, input: unknown): Promise<GoalDTO> {
    const data = parseSocialInput(createGoalSchema, input),
      spec = interpretGoal(data.text);
    return this.auth(token, async (tx, owner) => {
      const count = await tx.query<{ n: string }>(
        "SELECT count(*) n FROM agent_goals WHERE profile_id=$1 AND status NOT IN('COMPLETED','FAILED','CANCELLED')",
        [owner],
      );
      if (Number(count.rows[0]!.n) >= 30) fail("CONFLICT");
      await tx.query(
        "INSERT INTO agent_connector_accounts(profile_id) VALUES($1) ON CONFLICT DO NOTHING",
        [owner],
      );
      await tx.query(
        "INSERT INTO agent_autonomy_preferences(profile_id) VALUES($1) ON CONFLICT DO NOTHING",
        [owner],
      );
      const supported = spec.type !== "unsupported";
      const g = (
        await tx.query<GoalRow>(
          `INSERT INTO agent_goals(public_key,profile_id,title,raw_text,status,spec,currency,target_amount_minor,failure_code,next_tool) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            opaqueKey(),
            owner,
            spec.type === "earn_money"
              ? `Заработать ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(spec.targetAmountMinor / 100).replaceAll("\u00a0", " ")} ${{ RUB: "₽", USD: "$", EUR: "€" }[spec.currency]}`
              : data.text.slice(0, 140),
            data.text,
            supported ? "PLANNING" : "PAUSED",
            JSON.stringify(spec),
            spec.currency,
            spec.targetAmountMinor,
            supported ? null : "CAPABILITY_UNAVAILABLE",
            spec.type === "find_people" ? "search_people" : "search",
          ],
        )
      ).rows[0]!;
      await tx.query("INSERT INTO agent_jobs(goal_id,status) VALUES($1,$2)", [
        g.id,
        supported ? "pending" : "sleeping",
      ]);
      await event(
        tx,
        g,
        supported ? "created" : "blocker",
        supported
          ? "Цель сохранена. Агент начнёт работу в демонстрационной среде."
          : "Для этой цели пока нет подключённой возможности.",
        "created",
      );
      return goalDTO(tx, g);
    });
  }
  async list(token: string) {
    return this.auth(token, async (tx, owner) => {
      const rows = await tx.query<GoalRow>(
        "SELECT * FROM agent_goals WHERE profile_id=$1 ORDER BY (status IN('COMPLETED','FAILED','CANCELLED')),created_at DESC LIMIT 30",
        [owner],
      );
      const result = [];
      for (const g of rows.rows) result.push(await goalDTO(tx, g));
      return result;
    });
  }
  async get(token: string, key: string) {
    parseSocialInput(keySchema, key);
    return this.auth(token, async (tx, owner) =>
      goalDTO(tx, await ownedGoal(tx, owner, key)),
    );
  }
  async command(token: string, key: string, input: unknown) {
    parseSocialInput(keySchema, key);
    const data = parseSocialInput(commandSchema, input);
    return this.auth(token, async (tx, owner) => {
      const g = await ownedGoal(tx, owner, key, true);
      if (terminalStatuses.includes(g.status)) fail("CONFLICT");
      const next =
        data.type === "pause"
          ? "PAUSED"
          : data.type === "cancel"
            ? "CANCELLED"
            : "ACTIVE";
      if (
        data.type === "resume" &&
        (g.status !== "PAUSED" || g.spec.type === "unsupported")
      )
        fail("CONFLICT");
      assertTransition(g.status, next);
      await tx.query(
        "UPDATE agent_goals SET status=$2,failure_code=NULL,updated_at=clock_timestamp() WHERE id=$1",
        [g.id, next],
      );
      await tx.query(
        "UPDATE agent_jobs SET status=$2,lease_key=NULL,lease_until=NULL,attempts=0,available_at=clock_timestamp() WHERE goal_id=$1",
        [
          g.id,
          next === "ACTIVE"
            ? "pending"
            : next === "CANCELLED"
              ? "done"
              : "sleeping",
        ],
      );
      if (next === "CANCELLED")
        await tx.query(
          "UPDATE agent_approvals SET status='expired' WHERE goal_id=$1 AND status IN('pending','approved')",
          [g.id],
        );
      await event(
        tx,
        g,
        "command",
        data.type === "pause"
          ? "Выполнение приостановлено"
          : data.type === "cancel"
            ? "Цель отменена"
            : "Выполнение возобновлено",
        "command:" + opaqueKey(),
      );
      return goalDTO(tx, await ownedGoal(tx, owner, key));
    });
  }
  async approve(
    token: string,
    key: string,
    approvalKey: string,
    input: unknown,
  ) {
    parseSocialInput(keySchema, key);
    parseSocialInput(keySchema, approvalKey);
    const data = parseSocialInput(approvalSchema, input);
    return this.auth(token, async (tx, owner) => {
      const g = await ownedGoal(tx, owner, key, true);
      if (g.status !== "WAITING_APPROVAL") fail("CONFLICT");
      const approval = (
        await tx.query<{ id: string }>(
          `SELECT a.id FROM agent_approvals a JOIN agent_steps s ON s.id=a.step_id AND s.goal_id=a.goal_id WHERE a.goal_id=$1 AND a.public_key=$2 AND a.status='pending' AND a.expires_at>clock_timestamp() AND a.input_hash=s.input_hash AND a.revision=s.revision AND a.revision=$3 AND s.status='pending' AND s.tool='invoice' FOR UPDATE OF a`,
          [g.id, approvalKey, g.revision],
        )
      ).rows[0];
      if (!approval) fail("CONFLICT");
      await tx.query("UPDATE agent_approvals SET status=$2 WHERE id=$1", [
        approval.id,
        data.decision === "approve" ? "approved" : "declined",
      ]);
      const next = data.decision === "approve" ? "ACTIVE" : "PAUSED";
      assertTransition(g.status, next);
      await tx.query(
        "UPDATE agent_goals SET status=$2,updated_at=clock_timestamp() WHERE id=$1",
        [g.id, next],
      );
      await tx.query(
        "UPDATE agent_jobs SET status=$2,available_at=clock_timestamp(),attempts=0,lease_key=NULL,lease_until=NULL WHERE goal_id=$1",
        [g.id, next === "ACTIVE" ? "pending" : "sleeping"],
      );
      await event(
        tx,
        g,
        "decision",
        next === "ACTIVE"
          ? "Выставление этого счёта одобрено"
          : "Выставление счёта отклонено; цель приостановлена",
        "decision:" + approvalKey,
      );
      return goalDTO(tx, await ownedGoal(tx, owner, key));
    });
  }
  async connections(token: string): Promise<ConnectionDTO[]> {
    return this.auth(token, async (tx, owner) => {
      const enabled =
        (
          await tx.query<{ enabled: boolean }>(
            "SELECT enabled FROM agent_connector_accounts WHERE profile_id=$1",
            [owner],
          )
        ).rows[0]?.enabled ?? true;
      return [
        {
          id: "mock",
          name: "Демонстрационная среда",
          description:
            "Тестовые заказы, клиенты и оплата. Реальные деньги не используются.",
          available: true,
          enabled,
          environment: "demo",
        },
        ...["GitHub", "Email", "Calendar"].map((name) => ({
          id: name.toLowerCase(),
          name,
          description: "Подключение пока недоступно",
          available: false,
          enabled: false,
          environment: null,
        })),
      ];
    });
  }
  async setConnection(token: string, input: unknown) {
    const data = parseSocialInput(connectionSchema, input);
    await this.auth(token, async (tx, owner) => {
      await tx.query(
        "INSERT INTO agent_connector_accounts(profile_id,enabled) VALUES($1,$2) ON CONFLICT(profile_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=clock_timestamp()",
        [owner, data.enabled],
      );
    });
    return this.connections(token);
  }
  async policy(token: string): Promise<AutonomyPolicy> {
    return this.auth(token, async (tx, owner) => ({
      communicationLimit:
        (
          await tx.query<{ communication_limit: number }>(
            "SELECT communication_limit FROM agent_autonomy_preferences WHERE profile_id=$1",
            [owner],
          )
        ).rows[0]?.communication_limit ?? 5,
      maxCommunicationLimit: 10,
      financialApprovalRequired: true,
    }));
  }
  async savePolicy(token: string, input: unknown) {
    const data = parseSocialInput(autonomySchema, input);
    await this.auth(token, async (tx, owner) => {
      await tx.query(
        "INSERT INTO agent_autonomy_preferences(profile_id,communication_limit) VALUES($1,$2) ON CONFLICT(profile_id) DO UPDATE SET communication_limit=EXCLUDED.communication_limit",
        [owner, data.communicationLimit],
      );
      await tx.query(
        "UPDATE agent_jobs j SET available_at=clock_timestamp() FROM agent_goals g WHERE j.goal_id=g.id AND g.profile_id=$1 AND g.status='WAITING_EXTERNAL' AND g.failure_code='COMMUNICATION_LIMIT' AND j.status='pending'",
        [owner],
      );
    });
    return this.policy(token);
  }
  async artifact(token: string, key: string, artifactKey: string) {
    parseSocialInput(keySchema, key);
    parseSocialInput(keySchema, artifactKey);
    return this.auth(token, async (tx, owner) => {
      const g = await ownedGoal(tx, owner, key);
      const row =
        (
          await tx.query<{
            storage_ref: string;
            title: string;
            media_type: string;
          }>(
            "SELECT storage_ref,title,media_type FROM agent_artifacts WHERE goal_id=$1 AND public_key=$2",
            [g.id, artifactKey],
          )
        ).rows[0] ?? fail("NOT_FOUND");
      return {
        content: await new MockArtifactStorage().get(row.storage_ref),
        title: row.title,
        mediaType: row.media_type,
      };
    });
  }
  async activity(token: string) {
    return this.auth(token, (tx, owner) => goalActivity(tx, owner));
  }
}
