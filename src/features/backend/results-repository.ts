import "server-only";
import { createHash } from "node:crypto";
import type { DatabaseExecutor } from "@/lib/db/types";
import { proposalCopy } from "@/features/scheduling/presentation";
import { ENGINE_VERSION, suggest } from "@/features/scheduling/engine";
import type {
  PlanCandidate,
  SchedulingParticipant,
  SchedulingPreference,
} from "@/features/scheduling/types";
import { projectIntent } from "./repository";
import type { IntentRow } from "./types";
import type { ResultsView, VoteValue } from "./results-types";
export interface GroupPerson extends SchedulingParticipant {
  displayName: string;
  guestId: string | null;
}
export interface ProposalRow {
  id: string;
  public_key: string;
  title: string;
  start_at: Date;
  end_at: Date;
  score: number;
  available_count: number;
  explanation: string | null;
  details: Partial<PlanCandidate> & { rank?: number; engineVersion?: string };
}
export async function loadPeople(
  tx: DatabaseExecutor,
  intentId: string,
): Promise<GroupPerson[]> {
  const people = await tx.query<{
    id: string;
    guest_id: string | null;
    display_name: string;
    budget_min: number | null;
    budget_max: number | null;
    currency: string | null;
  }>(
    "SELECT id,guest_id,display_name,budget_min,budget_max,currency FROM participants WHERE intent_id=$1 ORDER BY display_name,id",
    [intentId],
  );
  const windows = await tx.query<{
    participant_id: string;
    start_at: Date;
    end_at: Date;
  }>(
    "SELECT w.participant_id,w.start_at,w.end_at FROM availability_windows w JOIN participants p ON p.id=w.participant_id WHERE p.intent_id=$1 ORDER BY w.start_at,w.end_at",
    [intentId],
  );
  const preferences = await tx.query<
    SchedulingPreference & { participant_id: string }
  >(
    "SELECT f.participant_id,f.category,f.value FROM preferences f JOIN participants p ON p.id=f.participant_id WHERE p.intent_id=$1 ORDER BY f.category,f.value",
    [intentId],
  );
  return people.rows.map((p) => ({
    id: p.id,
    guestId: p.guest_id,
    displayName: p.display_name,
    budgetMin: p.budget_min,
    budgetMax: p.budget_max,
    currency: p.currency,
    availability: windows.rows
      .filter((w) => w.participant_id === p.id)
      .map((w) => ({
        startAt: w.start_at.toISOString(),
        endAt: w.end_at.toISOString(),
      })),
    preferences: preferences.rows
      .filter((f) => f.participant_id === p.id)
      .map((f) => ({ category: f.category, value: f.value })),
  }));
}
export async function ensureResults(
  tx: DatabaseExecutor,
  intent: IntentRow,
): Promise<GroupPerson[]> {
  const people = await loadPeople(tx, intent.id);
  if (intent.status === "decided" || intent.status === "expired") return people;
  // A minute boundary keeps immediate proposals stable between read and vote.
  const from = new Date(Math.ceil(Date.now() / 60_000) * 60_000).toISOString();
  const result =
    Date.parse(from) >= intent.expires_at.getTime()
      ? { bestMatch: null, alternatives: [] }
      : suggest({
          participants: people,
          durationMinutes: 60,
          from,
          until: intent.expires_at.toISOString(),
          activities: intent.structured_intent.activities,
        });
  const candidates = result.bestMatch
    ? [result.bestMatch, ...result.alternatives]
    : [];
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        version: ENGINE_VERSION,
        people,
        activities: intent.structured_intent.activities,
        candidates,
      }),
    )
    .digest("hex");
  if (intent.suggestions_fingerprint === fingerprint) return people;
  await tx.query("DELETE FROM plan_suggestions WHERE intent_id=$1", [
    intent.id,
  ]);
  for (const [rank, c] of candidates.entries())
    await tx.query(
      "INSERT INTO plan_suggestions(intent_id,title,start_at,end_at,score,available_count,explanation,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        intent.id,
        c.activity ? `Время для ${c.activity}` : "Удобное время для встречи",
        c.window.startAt,
        c.window.endAt,
        c.score,
        c.availableParticipantIds.length,
        c.explanation,
        JSON.stringify({ ...c, rank, engineVersion: ENGINE_VERSION }),
      ],
    );
  const updated = await tx.query<{ scheduling_revision: string }>(
    "UPDATE intents SET suggestions_fingerprint=$2,scheduling_revision=scheduling_revision+1,status=$3 WHERE id=$1 RETURNING scheduling_revision",
    [intent.id, fingerprint, candidates.length ? "ready" : "collecting"],
  );
  intent.suggestions_fingerprint = fingerprint;
  intent.scheduling_revision = updated.rows[0]!.scheduling_revision;
  intent.status = candidates.length ? "ready" : "collecting";
  return people;
}
export async function readProposals(
  tx: DatabaseExecutor,
  intentId: string,
): Promise<ProposalRow[]> {
  return (
    await tx.query<ProposalRow>(
      "SELECT * FROM plan_suggestions WHERE intent_id=$1 ORDER BY COALESCE((details->>'rank')::int,999),start_at,id",
      [intentId],
    )
  ).rows;
}
const voteValue = (value: number): VoteValue =>
  value === 1 ? "yes" : value === 0 ? "maybe" : "no";
export async function projectResults(
  tx: DatabaseExecutor,
  intent: IntentRow,
  guestId: string | null,
  people: GroupPerson[],
): Promise<ResultsView> {
  const view = await projectIntent(tx, intent, guestId),
    proposals = await readProposals(tx, intent.id),
    member = guestId !== null && people.some((p) => p.guestId === guestId),
    named = view.isCreator || member;
  const totals = await tx.query<{
    suggestion_id: string;
    value: number;
    count: string;
  }>(
    "SELECT suggestion_id,value,count(*) FROM votes WHERE intent_id=$1 GROUP BY suggestion_id,value",
    [intent.id],
  );
  const own = guestId
    ? await tx.query<{ suggestion_id: string; value: number }>(
        "SELECT v.suggestion_id,v.value FROM votes v JOIN participants p ON p.id=v.participant_id WHERE v.intent_id=$1 AND p.guest_id=$2",
        [intent.id, guestId],
      )
    : { rows: [] };
  const suggestions = proposals.map((p) => {
    const full =
      p.details.availableParticipantIds ??
      people
        .filter((person) =>
          person.availability.some(
            (w) =>
              Date.parse(w.startAt) <= p.start_at.getTime() &&
              Date.parse(w.endAt) >= p.end_at.getTime(),
          ),
        )
        .map((person) => person.id);
    const partial = p.details.partialParticipantIds ?? [];
    const votes = { yes: 0, maybe: 0, no: 0 };
    for (const total of totals.rows.filter((v) => v.suggestion_id === p.id))
      votes[voteValue(total.value)] = Number(total.count);
    const ownVote = own.rows.find((v) => v.suggestion_id === p.id);
    const copy = proposalCopy({ activity: p.details.activity ?? null, availableCount: p.available_count, totalCount: people.length,
      durationMinutes: p.details.durationMinutes ?? (p.end_at.getTime() - p.start_at.getTime()) / 60000,
      shortened: p.details.shortened ?? false, budgetAssessment: p.details.budgetAssessment ?? "unknown" });
    return {
      suggestionKey: p.public_key,
      title: copy.title,
      window: {
        startAt: p.start_at.toISOString(),
        endAt: p.end_at.toISOString(),
      },
      availableCount: p.available_count,
      partialCount: partial.length,
      totalCount: people.length,
      score: p.score,
      durationMinutes:
        p.details.durationMinutes ??
        (p.end_at.getTime() - p.start_at.getTime()) / 60000,
      shortened: p.details.shortened ?? false,
      activity: p.details.activity ?? null,
      budgetAssessment: p.details.budgetAssessment ?? "unknown",
      explanation: copy.explanation,
      votes,
      ownVote: ownVote ? voteValue(ownVote.value) : null,
      ...(named
        ? {
            attendance: people.map((person) => ({
              displayName: person.displayName,
              status: full.includes(person.id)
                ? ("available" as const)
                : partial.includes(person.id)
                  ? ("partial" as const)
                  : ("unavailable" as const),
            })),
          }
        : {}),
    };
  });
  const withAvailability = people.filter((p) =>
    p.availability.some(
      (w) =>
        Date.parse(w.endAt) > Date.now() &&
        Date.parse(w.startAt) < intent.expires_at.getTime(),
    ),
  ).length;
  const selected = proposals.find(
    (p) => p.id === intent.selected_suggestion_id,
  );
  return {
    ...view,
    revision: Number(intent.scheduling_revision),
    selectedSuggestionKey: selected?.public_key ?? null,
    suggestions,
    message:
      suggestions.find(p => p.suggestionKey === (selected ?? proposals[0])?.public_key)?.explanation ??
      "Попросите друзей указать более длинные промежутки свободного времени в будущем, чтобы найти общее время.",
    canVote: member && intent.status === "ready",
    summary: {
      participantsWithAvailability: withAvailability,
      participantsMissingAvailability: people.length - withAvailability,
    },
  };
}
