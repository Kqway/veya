import { z } from "zod";
import { privacyModeSchema, ageBandSchema } from "./profile-schema";
const text = (max: number) => z.string().trim().min(1).max(max);
const instant = z.iso.datetime({ offset: true });
export const publicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
export const seekingSchema = z
  .object({
    rawText: text(500),
    activityKey: text(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    activityLabel: text(80),
    interactionMode: z.enum(["in_person", "online", "either"]),
    format: z.enum(["one_to_one", "group", "either"]),
    city: text(60).nullable().default(null),
    area: text(60).nullable().default(null),
    availability: z
      .array(z.object({ startAt: instant, endAt: instant }).strict())
      .min(1)
      .max(14),
    skill: z
      .enum(["beginner", "casual", "intermediate", "advanced", "expert", "any"])
      .default("any"),
    languages: z
      .array(text(20).regex(/^[a-z]{2}(?:-[a-z]{2})?$/))
      .min(1)
      .max(5),
    tags: z
      .array(text(40).transform((v) => v.toLowerCase()))
      .max(8)
      .default([]),
    desiredAgeBands: z.array(ageBandSchema).max(5).default([]),
    groupSize: z.number().int().min(2).max(12).nullable().default(null),
    privacyMode: privacyModeSchema.optional(),
    expiresAt: instant.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.interactionMode !== "online" && !v.city)
      ctx.addIssue({
        code: "custom",
        path: ["city"],
        message: "Выберите город для личных встреч.",
      });
    for (const key of ["languages", "tags", "desiredAgeBands"] as const)
      if (new Set(v[key]).size !== v[key].length)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Удалите повторяющиеся варианты.",
        });
    if (v.format === "one_to_one" && v.groupSize !== null)
      ctx.addIssue({
        code: "custom",
        path: ["groupSize"],
        message: "Размер группы указывают только для групповых встреч.",
      });
  });
export type SeekingInput = z.infer<typeof seekingSchema>;
export const ownPostSchema = z
  .object({
    publicKey: publicKeySchema,
    rawText: text(500),
    activityKey: text(40),
    activityLabel: text(80),
    interactionMode: z.enum(["in_person", "online", "either"]),
    format: z.enum(["one_to_one", "group", "either"]),
    city: text(60).nullable(),
    area: text(60).nullable(),
    availability: z
      .array(z.object({ startAt: instant, endAt: instant }).strict())
      .max(14),
    skill: z.enum([
      "beginner",
      "casual",
      "intermediate",
      "advanced",
      "expert",
      "any",
    ]),
    languages: z.array(text(20)).max(5),
    tags: z.array(text(40)).max(8),
    desiredAgeBands: z.array(ageBandSchema).max(5),
    groupSize: z.number().int().min(2).max(12).nullable(),
    privacyMode: privacyModeSchema,
    status: z.enum(["active", "closed", "expired"]),
    expiresAt: instant,
  })
  .strict();
export type OwnPost = z.infer<typeof ownPostSchema>;
export function strongerMode(
  a: "OPEN" | "PRIVATE" | "INCOGNITO",
  b?: "OPEN" | "PRIVATE" | "INCOGNITO",
) {
  const order = { OPEN: 0, PRIVATE: 1, INCOGNITO: 2 };
  return b && order[b] > order[a] ? b : a;
}
