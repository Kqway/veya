import { z } from "zod";
import { presentationSchema } from "@/features/profile-space/schema";
import { identitySchema } from "./privacy";
import { publicKeySchema } from "./seeking-schema";
export const cardSchema = z
  .object({
    handle: publicKeySchema,
    identity: identitySchema,
    presentation: presentationSchema,
    activityLabel: z.string().min(1).max(80),
    interactionMode: z.enum(["in_person", "online", "either"]),
    format: z.enum(["one_to_one", "group", "either"]),
    reasons: z
      .array(
        z.enum([
          "SAME_ACTIVITY",
          "TIME_OVERLAP",
          "SAME_AREA",
          "SKILL_COMPATIBLE",
          "SHARED_LANGUAGE",
          "SHARED_INTEREST",
          "FORMAT_COMPATIBLE",
        ]),
      )
      .max(7),
    timeHint: z.enum([
      "Compatible today",
      "Compatible tomorrow",
      "Compatible this week",
      "Compatible soon",
    ]),
  })
  .strict();
export const requestResultSchema = z
  .object({
    publicKey: publicKeySchema,
    status: z.enum(["pending", "accepted", "declined", "expired"]),
    matchKey: publicKeySchema.nullable(),
  })
  .strict();
export const incomingRequestSchema = requestResultSchema
  .extend({
    direction: z.enum(["incoming", "outgoing"]),
    identity: identitySchema,
    activityLabel: z.string().min(1).max(80),
  })
  .strict();
export const matchSchema = z
  .object({
    publicKey: publicKeySchema,
    status: z.enum(["active", "closed"]),
    identity: identitySchema,
    ownIdentity: identitySchema,
    activityLabel: z.string().min(1).max(80),
    disclosures: z
      .array(
        z
          .object({
            kind: z.enum(["first_name", "contact_handle"]),
            value: z.string().max(120),
            isMine: z.boolean(),
          })
          .strict(),
      )
      .max(4),
    planSlug: publicKeySchema.nullable(),
  })
  .strict();
export const messageSchema = z
  .object({
    publicKey: publicKeySchema,
    text: z.string().min(1).max(2000),
    createdAt: z.iso.datetime({ offset: true }),
    isMine: z.boolean(),
    identity: identitySchema,
  })
  .strict();
export type DiscoveryCard = z.infer<typeof cardSchema>;
export type RequestDTO = z.infer<typeof incomingRequestSchema>;
export type MatchDTO = z.infer<typeof matchSchema>;
export type MessageDTO = z.infer<typeof messageSchema>;
