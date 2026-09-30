import { z } from "zod";
import { BackendError } from "./errors";

const instant = z.iso.datetime({ offset: true });
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));
export const slugSchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
export const createIntentSchema = z.object({
  rawText: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(120).optional(),
  creatorName: z.string().trim().min(1).max(60).default("A friend"),
  structuredIntent: z.object({
    type: z.enum(["general", "meet", "travel", "game", "study"]).default("general"),
    activities: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
    location: z.string().trim().min(1).max(120).nullable().default(null),
  }).strict().default({ type: "general", activities: [], location: null }),
  expiresAt: instant.optional(),
}).strict();

export const participantSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  budgetMin: z.number().int().min(0).max(100_000_000).nullable().default(null),
  budgetMax: z.number().int().min(0).max(100_000_000).nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/).refine((value) => supportedCurrencies.has(value)).nullable().default(null),
  notes: z.string().trim().max(1000).default(""),
  availability: z.array(z.object({ startAt: instant, endAt: instant }).strict()).max(28).default([]),
  preferences: z.array(z.object({
    category: z.enum(["activity", "dietary", "location"]),
    value: z.string().trim().min(1).max(80).transform((value) => value.toLowerCase()),
  }).strict()).max(20).default([]),
}).strict().superRefine((data, ctx) => {
  if (data.budgetMin !== null && data.budgetMax !== null && data.budgetMin > data.budgetMax) {
    ctx.addIssue({ code: "custom", path: ["budgetMax"], message: "Budget range is reversed." });
  }
  const hasBudget = data.budgetMin !== null || data.budgetMax !== null;
  if (hasBudget !== (data.currency !== null)) ctx.addIssue({ code: "custom", path: ["currency"], message: "Currency must accompany a budget." });
  const keys = data.preferences.map((item) => `${item.category}:${item.value}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["preferences"], message: "Duplicate preference." });
});

export type ParticipantInput = z.infer<typeof participantSchema>;
export type StructuredIntent = z.infer<typeof createIntentSchema>["structuredIntent"];

export function validate<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BackendError("INVALID_INPUT");
  return parsed.data;
}

export function validateWindows(data: ParticipantInput, expiresAt: Date): void {
  const now = Date.now();
  const latest = Math.min(expiresAt.getTime(), now + 30 * 86_400_000);
  const windows = data.availability.map((window) => ({ start: Date.parse(window.startAt), end: Date.parse(window.endAt) })).sort((a, b) => a.start - b.start);
  let previousEnd = -Infinity;
  for (const window of windows) {
    if (window.start < now || window.end > latest || window.end <= window.start ||
      window.end - window.start > 86_400_000 || window.start < previousEnd) throw new BackendError("INVALID_INPUT");
    previousEnd = window.end;
  }
}
