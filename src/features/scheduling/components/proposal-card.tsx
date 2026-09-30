"use client";
import type {
  ResultProposal,
  VoteValue,
} from "@/features/backend/results-types";
import { formatWindow } from "@/features/entry/components/availability-picker";
export function ProposalCard({
  proposal,
  label,
  canVote,
  canDecide,
  busy,
  onVote,
  onChoose,
}: {
  proposal: ResultProposal;
  label: string;
  canVote: boolean;
  canDecide: boolean;
  busy: boolean;
  onVote: (value: VoteValue) => void;
  onChoose: () => void;
}) {
  return (
    <section className="entry-card proposal-card" aria-label={label}>
      <p className="eyebrow">{label}</p>
      <h2>{proposal.title}</h2>
      <p className="proposal-time">{formatWindow(proposal.window)}</p>
      <p className="attendance-count">
        <strong>
          {proposal.availableCount} of {proposal.totalCount}
        </strong>{" "}
        available · {proposal.durationMinutes} minutes
      </p>
      {proposal.partialCount > 0 && (
        <p className="quiet-copy">
          {proposal.partialCount} could join for part of this time.
        </p>
      )}
      <p className="proposal-explanation">{proposal.explanation}</p>
      {proposal.budgetAssessment === "compatible" && (
        <p className="quiet-copy">Shared budget ranges overlap.</p>
      )}
      {proposal.attendance && (
        <ul className="attendance-list" aria-label="Group availability">
          {proposal.attendance.map((p, index) => (
            <li key={index}>
              <span>{p.displayName}</span>
              <span className={`attendance-${p.status}`}>
                {p.status === "available"
                  ? "Available"
                  : p.status === "partial"
                    ? "Partly available"
                    : "Unavailable"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="vote-counts" aria-label="Group votes">
        YES {proposal.votes.yes} · MAYBE {proposal.votes.maybe} · NO{" "}
        {proposal.votes.no}
      </p>
      {canVote && (
        <div
          className="vote-buttons"
          role="group"
          aria-label={`Vote on ${label}`}
        >
          {(["yes", "maybe", "no"] as const).map((value) => (
            <button
              className="choice-chip"
              type="button"
              key={value}
              disabled={busy}
              aria-pressed={proposal.ownVote === value}
              onClick={() => onVote(value)}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {canDecide && (
        <button
          className="button button-secondary choose-plan"
          disabled={busy}
          type="button"
          onClick={onChoose}
        >
          Choose this plan
        </button>
      )}
    </section>
  );
}
