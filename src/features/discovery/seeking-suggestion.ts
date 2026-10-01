import { z } from "zod";

/** Editable suggestions only; availability and matching are user/server owned. */
export const seekingSuggestionSchema = z
  .object({
    activityKey: z.string().max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable(),
    activityLabel: z.string().trim().min(1).max(80).nullable(),
    interactionMode: z.enum(["in_person", "online", "either"]).nullable(),
    format: z.enum(["one_to_one", "group", "either"]).nullable(),
    city: z.string().trim().min(1).max(60).nullable(),
    area: z.string().trim().min(1).max(60).nullable(),
    skill: z.enum(["beginner", "casual", "intermediate", "advanced", "expert", "any"]).nullable(),
    languages: z.array(z.string().trim().min(2).max(20)).max(5),
    tags: z.array(z.string().trim().min(1).max(40)).max(8),
    timeHint: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

export type SeekingSuggestion = z.infer<typeof seekingSuggestionSchema>;
