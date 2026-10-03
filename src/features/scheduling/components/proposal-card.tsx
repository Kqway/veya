"use client";
import { PlanAssistance } from "./plan-assistance";
import type {
  ResultProposal,
  VoteValue,
} from "@/features/backend/results-types";
import { formatWindow } from "@/features/entry/components/availability-picker";
export function ProposalCard({
  slug,
  revision,
  canAssist,
  proposal,
  label,
  canVote,
  canDecide,
  busy,
  onVote,
  onChoose,
}: {
  slug: string;
  revision: number;
  canAssist: boolean;
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
          {proposal.availableCount} из {proposal.totalCount}
        </strong>{" "}
        могут прийти · {proposal.durationMinutes} мин.
      </p>
      {proposal.partialCount > 0 && (
        <p className="quiet-copy">
          Могут присоединиться на часть встречи: {proposal.partialCount}.
        </p>
      )}
      <p className="proposal-explanation">{proposal.explanation}</p>
      {proposal.budgetAssessment === "compatible" && (
        <p className="quiet-copy">Бюджеты участников совместимы.</p>
      )}
      {proposal.attendance && (
        <ul className="attendance-list" aria-label="Свободное время участников">
          {proposal.attendance.map((p, index) => (
            <li key={index}>
              <span>{p.displayName}</span>
              <span className={`attendance-${p.status}`}>
                {p.status === "available"
                  ? "Может прийти"
                  : p.status === "partial"
                    ? "Может прийти на часть встречи"
                    : "Не может прийти"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="vote-counts" aria-label="Голоса участников">
        ДА {proposal.votes.yes} · ВОЗМОЖНО {proposal.votes.maybe} · НЕТ{" "}
        {proposal.votes.no}
      </p>
      {canVote && (
        <div
          className="vote-buttons"
          role="group"
          aria-label={`Голосование: ${label}`}
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
              {{ yes: "ДА", maybe: "ВОЗМОЖНО", no: "НЕТ" }[value]}
            </button>
          ))}
        </div>
      )}
      {canAssist && (
        <PlanAssistance
          slug={slug}
          suggestionKey={proposal.suggestionKey}
          revision={revision}
          disabled={busy}
        />
      )}
      {canDecide && (
        <button
          className="button button-secondary choose-plan"
          disabled={busy}
          type="button"
          onClick={onChoose}
        >
          Выбрать этот план
        </button>
      )}
    </section>
  );
}
