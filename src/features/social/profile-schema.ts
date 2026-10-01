import { z } from "zod";
import { fail } from "./errors";
export const privacyModeSchema = z.enum(["OPEN", "PRIVATE", "INCOGNITO"]);
export const ageBandSchema = z.enum(["18-20", "21-24", "25-29", "30-39", "40+"]);
export const aliasSchema = z.string().trim().min(1).max(60);
export const languagesSchema = z.array(z.string().max(20).regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/)).max(5).refine((items) => new Set(items).size === items.length);
const editable = {
  alias: aliasSchema,
  privacyMode: privacyModeSchema,
  ageBand: ageBandSchema.nullable().optional(),
  languages: languagesSchema.optional(),
};
export const createProfileSchema = z.object({ ...editable, adultConfirmed: z.literal(true) }).strict();
export const updateProfileSchema = z.object(editable).partial().strict().refine((value) => Object.values(value).some((item) => item !== undefined));
export const recoverySchema = z.object({ key: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export function parseSocialInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) fail("INVALID_INPUT");
  return result.data;
}
