import { z } from "zod";
export const intentTypeSchema = z.enum([
  "general",
  "meet",
  "travel",
  "game",
  "study",
]);
const activities = z.array(z.string().trim().min(1).max(80)).max(10);
const location = z.string().trim().min(1).max(120).nullable();
export const dateHintSchema = z
  .object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    text: z.string().trim().min(1).max(80),
  })
  .strict()
  .refine(
    (value) => value.startDate <= value.endDate,
    "Начальная дата должна быть не позже конечной.",
  );
const budgetHint = z.string().trim().min(1).max(80).nullable();
export const structuredIntentSchema = z
  .object({
    type: intentTypeSchema.default("general"),
    activities: activities.default([]),
    location: location.default(null),
    dateHint: dateHintSchema.nullable().optional(),
    budgetHint: budgetHint.optional(),
  })
  .strict();
export const parsedIntentSchema = z
  .object({
    type: intentTypeSchema,
    activities,
    location,
    dateHint: dateHintSchema.nullable(),
    budgetHint,
  })
  .strict();
export type ParsedIntent = z.infer<typeof parsedIntentSchema>;
