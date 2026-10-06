import { z } from "zod";
export const goalStatuses = [
  "DRAFT",
  "PLANNING",
  "ACTIVE",
  "WAITING_EXTERNAL",
  "WAITING_APPROVAL",
  "PAUSED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type GoalStatus = (typeof goalStatuses)[number];
export const currencySchema = z.enum(["RUB", "USD", "EUR"]);
export type Currency = z.infer<typeof currencySchema>;
export const goalSpecSchema = z
  .object({
    type: z.enum(["earn_money", "find_people", "unsupported"]),
    targetAmountMinor: z.number().int().min(0).max(100000000),
    currency: currencySchema,
    successCriteria: z.array(z.string().max(300)).max(8),
    constraints: z.object({ maxSpendMinor: z.literal(0) }).strict(),
    needs: z.array(z.string().max(200)).max(8),
    offers: z.array(z.string().max(200)).max(8),
    valueExchange: z.string().max(300),
  })
  .strict();
export type GoalSpec = z.infer<typeof goalSpecSchema>;
export interface GoalEventDTO {
  publicKey: string;
  type: string;
  description: string;
  evidenceRef: string | null;
  createdAt: string;
  goalKey?: string;
}
export interface GoalArtifactDTO {
  publicKey: string;
  kind:
    | "document"
    | "code"
    | "research"
    | "proposal"
    | "invoice"
    | "deliverable"
    | "archive"
    | "link";
  title: string;
  mediaType: string;
  byteSize: number;
  checksum: string;
  verified: boolean;
  createdAt: string;
}
export interface GoalApprovalDTO {
  publicKey: string;
  action: string;
  description: string;
  status: "pending" | "approved" | "declined" | "expired";
  amountMinor: number;
  currency: Currency;
  expiresAt: string;
  createdAt: string;
}
export interface GoalDealDTO {
  publicKey: string;
  title: string;
  status: string;
  amountMinor: number;
  currency: Currency;
  revision: number;
}
export interface GoalDTO {
  publicKey: string;
  title: string;
  rawText: string;
  status: GoalStatus;
  environment: "demo";
  spec: GoalSpec;
  confirmedAmountMinor: number;
  currency: Currency;
  currentAction: string | null;
  nextActions: string[];
  createdAt: string;
  updatedAt: string;
  events: GoalEventDTO[];
  artifacts: GoalArtifactDTO[];
  approvals: GoalApprovalDTO[];
  deals: GoalDealDTO[];
  failureCode: string | null;
}
export interface ConnectionDTO {
  id: string;
  name: string;
  description: string;
  available: boolean;
  enabled: boolean;
  environment: "demo" | null;
}
export interface AutonomyPolicy {
  communicationLimit: number;
  maxCommunicationLimit: 10;
  financialApprovalRequired: true;
}
export const createGoalSchema = z
  .object({
    text: z.string().trim().min(3).max(2000),
    environment: z.literal("demo"),
  })
  .strict();
export const commandSchema = z
  .object({ type: z.enum(["pause", "resume", "cancel"]) })
  .strict();
export const approvalSchema = z
  .object({ decision: z.enum(["approve", "decline"]) })
  .strict();
export const connectionSchema = z.object({ enabled: z.boolean() }).strict();
export const autonomySchema = z
  .object({ communicationLimit: z.number().int().min(0).max(10) })
  .strict();
export const keySchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
