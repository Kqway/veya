import "server-only";
import { z } from "zod";
import type { Database, DatabaseExecutor } from "@/lib/db/types";
import { createDatabaseAnalyticsClient } from "@/lib/analytics/postgres";
import { BackendError } from "./errors";
import { readIntent, requireOpenIntent } from "./repository";
import { findSession, requireSession } from "./sessions";
import { slugSchema, validate } from "./validation";
import type { IntentRow } from "./types";
import {
  ensureResults,
  projectResults,
  readProposals,
} from "./results-repository";
import type { ResultsView } from "./results-types";
const selection = z
  .object({
    suggestionKey: z.string().regex(/^[a-f0-9]{32}$/),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const voteSchema = selection.extend({ value: z.enum(["yes", "maybe", "no"]) });
export class ResultsService {
  constructor(
    private readonly db: Database,
    private readonly options: { analyticsEnabled?: boolean } = {},
  ) {}
  async getResults(slug: string, token?: string): Promise<ResultsView> {
    if (!slugSchema.safeParse(slug).success)
      throw new BackendError("NOT_FOUND");
    return this.db.transaction(async (tx) => {
      const intent = await readIntent(tx, slug, "write"),
        people = await ensureResults(tx, intent);
      return projectResults(tx, intent, await findSession(tx, token), people);
    });
  }
  private async proposal(
    tx: DatabaseExecutor,
    intent: IntentRow,
    data: z.infer<typeof selection>,
  ) {
    if (Number(intent.scheduling_revision) !== data.revision)
      throw new BackendError("STALE_RESULTS");
    const proposal = (await readProposals(tx, intent.id)).find(
      (p) => p.public_key === data.suggestionKey,
    );
    if (!proposal) throw new BackendError("STALE_RESULTS");
    return proposal;
  }
  async vote(
    token: string,
    slug: string,
    input: unknown,
  ): Promise<ResultsView> {
    const data = validate(voteSchema, input);
    validate(slugSchema, slug);
    return this.db.transaction(async (tx) => {
      const guest = await requireSession(tx, token),
        intent = await readIntent(tx, slug, "write");
      await requireSession(tx, token);
      requireOpenIntent(intent);
      const member = await tx.query<{ id: string }>(
        "SELECT id FROM participants WHERE intent_id=$1 AND guest_id=$2",
        [intent.id, guest],
      );
      if (!member.rows[0]) throw new BackendError("FORBIDDEN");
      const people = await ensureResults(tx, intent),
        proposal = await this.proposal(tx, intent, data);
      const changed = await tx.query(
        "INSERT INTO votes(intent_id,participant_id,suggestion_id,value) VALUES ($1,$2,$3,$4) ON CONFLICT (participant_id,suggestion_id) DO UPDATE SET value=EXCLUDED.value,updated_at=now() WHERE votes.value IS DISTINCT FROM EXCLUDED.value RETURNING participant_id",
        [
          intent.id,
          member.rows[0].id,
          proposal.id,
          data.value === "yes" ? 1 : data.value === "maybe" ? 0 : -1,
        ],
      );
      if (changed.rowCount && this.options.analyticsEnabled)
        await createDatabaseAnalyticsClient(tx).track({
          name: "vote_submitted",
          surface: "result",
        });
      return projectResults(tx, intent, guest, people);
    });
  }
  async decide(
    token: string,
    slug: string,
    input: unknown,
  ): Promise<ResultsView> {
    const data = validate(selection, input);
    validate(slugSchema, slug);
    return this.db.transaction(async (tx) => {
      const guest = await requireSession(tx, token),
        intent = await readIntent(tx, slug, "write");
      await requireSession(tx, token);
      if (intent.creator_guest_id !== guest)
        throw new BackendError("FORBIDDEN");
      if (intent.status !== "decided") requireOpenIntent(intent);
      const people = await ensureResults(tx, intent),
        proposal = await this.proposal(tx, intent, data);
      if (intent.status === "decided") {
        if (intent.selected_suggestion_id !== proposal.id)
          throw new BackendError("INTENT_CLOSED");
        return projectResults(tx, intent, guest, people);
      }
      await tx.query(
        "UPDATE intents SET status='decided',selected_suggestion_id=$2 WHERE id=$1",
        [intent.id, proposal.id],
      );
      intent.status = "decided";
      intent.selected_suggestion_id = proposal.id;
      return projectResults(tx, intent, guest, people);
    });
  }
}
