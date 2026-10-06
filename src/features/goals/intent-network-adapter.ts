import "server-only";
import { createHash } from "node:crypto";
import type { DatabaseExecutor } from "@/lib/db/types";
import { discoverInTransaction } from "@/features/social/discovery";
import {
  lockProfiles,
  requireCapability,
  type ProfileRow,
} from "@/features/social/context";
import { opaqueKey } from "@/features/social/pairs";
import { event, type GoalRow } from "./repository";
import { assertTransition } from "./state";
import { z } from "zod";
import type { VeyaTool } from "./execution";
import { cardSchema } from "@/features/social/network-projections";

const inputSchema = z
  .object({
    goalKey: z.string().regex(/^[A-Za-z0-9_-]{24}$/),
    activity: z.enum(["photography", "design", "chess"]),
  })
  .strict();
const outputSchema = z
  .object({
    cards: z.array(cardSchema).max(5),
    sourceKey: z.string().nullable(),
  })
  .strict();
/** READ capability shares authoritative compatibility and privacy projections.
 * The server-owned goal is the grant; no raw bearer token is stored in a job. */
interface PeopleContext {
  tx: DatabaseExecutor;
  owner: string;
  authorize: (locked: boolean) => Promise<ProfileRow>;
}
export const searchPeopleTool: VeyaTool<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>,
  PeopleContext
> = {
  name: "search_people",
  riskLevel: "READ",
  inputSchema,
  outputSchema,
  idempotent: true,
  transactional: true,
  async execute({ tx, owner, authorize }, rawInput) {
    const input = inputSchema.parse(rawInput);
    const source = (
      await tx.query<{ public_key: string }>(
        "SELECT public_key FROM seeking_posts WHERE profile_id=$1 AND activity_key=$2 AND status='active' AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1",
        [owner, input.activity],
      )
    ).rows[0];
    let cards: z.infer<typeof cardSchema>[] = [];
    if (source)
      cards = await discoverInTransaction(tx, source.public_key, authorize);
    else {
      await lockProfiles(tx, [owner]);
      await authorize(true);
    }
    return outputSchema.parse({ cards, sourceKey: source?.public_key ?? null });
  },
};
// Registered READ capability uses a different lock context from connector writes.
export const networkCapabilities = { search_people: searchPeopleTool } as const;
class StoppedPeopleGoal extends Error {}
interface Job {
  id: string;
  goal_id: string;
  profile_id: string;
  lease_key: string;
}
export async function processPeopleGoal(
  tx: DatabaseExecutor,
  j: Job,
  signal?: AbortSignal,
): Promise<boolean> {
  let goal = (
    await tx.query<GoalRow>("SELECT * FROM agent_goals WHERE id=$1", [
      j.goal_id,
    ])
  ).rows[0];
  if (!goal) return false;
  const input = inputSchema.parse({
    goalKey: goal.public_key,
    activity: goal.spec.needs[0],
  });

  let allowed = false;
  const authorize = async (locked: boolean): Promise<ProfileRow> => {
    if (signal?.aborted) throw new Error("Stopped");
    if (locked) {
      goal = (
        await tx.query<GoalRow>(
          "SELECT * FROM agent_goals WHERE id=$1 FOR UPDATE",
          [j.goal_id],
        )
      ).rows[0];
      const lease = (
        await tx.query(
          "SELECT id FROM agent_jobs WHERE id=$1 AND lease_key=$2 AND status='processing' AND lease_until>clock_timestamp() FOR UPDATE",
          [j.id, j.lease_key],
        )
      ).rows[0];
      if (
        !goal ||
        !lease ||
        goal.profile_id !== j.profile_id ||
        !["PLANNING", "ACTIVE", "WAITING_EXTERNAL"].includes(goal.status)
      )
        throw new Error("Stale goal grant");
    }
    const actor = (
      await tx.query<ProfileRow & { deleted_at: Date | null }>(
        "SELECT * FROM social_profiles WHERE id=$1 AND deleted_at IS NULL AND moderation_status='active'",
        [j.profile_id],
      )
    ).rows[0];
    if (!actor && locked && goal) {
      assertTransition(goal.status, "PAUSED");
      await tx.query(
        "UPDATE agent_goals SET status='PAUSED',failure_code='OWNER_UNAVAILABLE',updated_at=clock_timestamp() WHERE id=$1",
        [goal.id],
      );
      await event(
        tx,
        goal,
        "blocker",
        "Поиск остановлен: профиль недоступен",
        "network-owner",
      );
      await tx.query(
        "UPDATE agent_jobs SET status='sleeping',attempts=0,lease_key=NULL,lease_until=NULL WHERE id=$1 AND lease_key=$2",
        [j.id, j.lease_key],
      );
      throw new StoppedPeopleGoal();
    }
    if (!actor) throw new Error("Owner unavailable");
    await requireCapability(tx, j.profile_id, "seek");
    allowed = locked;
    return actor;
  };
  // Discovery takes all peer locks in sorted order before goal/job locks. Never
  // enter it from the monetary worker's owner-first lock scope.
  let result: z.infer<typeof outputSchema>;
  try {
    result = outputSchema.parse(
      await networkCapabilities.search_people.execute(
        { tx, owner: j.profile_id, authorize },
        input,
      ),
    );
  } catch (error) {
    if (error instanceof StoppedPeopleGoal) return true;
    throw error;
  }
  if (!allowed || !goal) return false;
  const valid = (
    await tx.query(
      "SELECT id FROM agent_jobs WHERE id=$1 AND lease_key=$2 AND lease_until>clock_timestamp()",
      [j.id, j.lease_key],
    )
  ).rows[0];
  if (!valid || signal?.aborted) throw new Error("Lease expired");
  const cards = result.cards,
    source = result.sourceKey;
  const actionKey = goal.public_key + ":search_people:" + goal.cycle;
  const step = (
    await tx.query<{ id: string }>(
      `INSERT INTO agent_steps(public_key,goal_id,action_key,tool,input,input_hash,revision,status,evidence,completed_at) VALUES($1,$2,$3,'search_people',$4,$5,0,'completed',$6,clock_timestamp()) ON CONFLICT(goal_id,action_key) DO UPDATE SET evidence=EXCLUDED.evidence,completed_at=EXCLUDED.completed_at RETURNING id`,
      [
        opaqueKey(),
        goal.id,
        actionKey,
        JSON.stringify(input),
        createHash("sha256").update(JSON.stringify(input)).digest("hex"),
        JSON.stringify({ sourceKey: result.sourceKey, cards: result.cards }),
      ],
    )
  ).rows[0]!;
  const description = !source
    ? "Для поиска нужны ваше реальное объявление и время доступности. Добавьте их в разделе «Люди и встречи»."
    : cards.length
      ? `Найдено ${cards.length} совместимый кандидат. Посмотрите реальные предложения в разделе «Люди и встречи».`
      : "Совместимых предложений пока нет. Проверим снова после возобновления цели.";
  await event(
    tx,
    goal,
    "step",
    description,
    "network:" + opaqueKey(),
    "step:" + step.id,
  );
  const failure = !source
    ? "SEEKING_REQUIRED"
    : cards.length
      ? "INTERACTION_REQUIRED"
      : "NO_COMPATIBLE_PEOPLE";
  assertTransition(goal.status, "PAUSED");
  await tx.query(
    "UPDATE agent_goals SET status='PAUSED',failure_code=$2,cycle=cycle+1,updated_at=clock_timestamp() WHERE id=$1",
    [goal.id, failure],
  );
  await event(
    tx,
    goal,
    "blocker",
    cards.length
      ? "Поиск выполнен. Договорённость и получение результата требуют вашего участия."
      : description,
    "network-blocker:" + opaqueKey(),
  );
  await tx.query(
    "UPDATE agent_jobs SET status='sleeping',attempts=0,lease_key=NULL,lease_until=NULL WHERE id=$1 AND lease_key=$2",
    [j.id, j.lease_key],
  );
  return true;
}
