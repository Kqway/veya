import type { GoalStatus } from "./schema";
export const terminalStatuses: readonly GoalStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];
const transitions: Record<GoalStatus, readonly GoalStatus[]> = {
  DRAFT: ["PLANNING", "CANCELLED"],
  PLANNING: ["ACTIVE", "PAUSED", "FAILED", "CANCELLED"],
  ACTIVE: [
    "WAITING_EXTERNAL",
    "WAITING_APPROVAL",
    "PAUSED",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ],
  WAITING_EXTERNAL: ["ACTIVE", "PAUSED", "FAILED", "CANCELLED"],
  WAITING_APPROVAL: ["ACTIVE", "PAUSED", "FAILED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};
export function assertTransition(from: GoalStatus, to: GoalStatus): void {
  if (from !== to && !transitions[from].includes(to))
    throw new Error("Invalid goal transition");
}
