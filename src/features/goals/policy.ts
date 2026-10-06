import type { ToolRisk } from "./tools";
export function policyDecision(
  risk: ToolRisk,
  approved: boolean,
  used: number,
  limit: number,
): "allow" | "approval" | "wait" {
  if (!Number.isInteger(limit) || limit < 0 || limit > 10)
    throw new Error("Invalid communication budget");
  if (["FINANCIAL", "LEGAL", "DESTRUCTIVE"].includes(risk))
    return approved ? "allow" : "approval";
  if (risk === "EXTERNAL_COMMUNICATION" && used >= limit) return "wait";
  return "allow";
}
