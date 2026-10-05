import { z } from "zod";
import { seekingSchema, publicKeySchema } from "@/features/social/seeking-schema";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
export const timezoneSchema = boundedText(80).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Укажите часовой пояс IANA.");
const activityKeySchema = boundedText(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const dotaRanks = ["herald", "guardian", "crusader", "archon", "legend", "ancient", "divine", "immortal", "any"] as const;
export const dotaAttributesSchema = z.object({
  role: z.enum(["support", "carry", "mid", "offlane", "any"]).optional(),
  rank: z.enum(dotaRanks).optional(), minRank: z.enum(dotaRanks).optional(),
  mode: z.enum(["ranked", "casual", "any"]).optional(),
}).strict();
const levelSchema = z.enum(["beginner", "intermediate", "advanced", "any"]);
export const gymAttributesSchema = z.object({ trainingType: z.enum(["strength", "cardio", "any"]).optional(), experience: levelSchema.optional() }).strict();
export const studyAttributesSchema = z.object({ subject: boundedText(60).optional(), level: levelSchema.optional() }).strict();
export const moviesAttributesSchema = z.object({ movie: boundedText(80).optional() }).strict();
export const emptyAttributesSchema = z.object({}).strict();
export const attributesSchema = z.union([dotaAttributesSchema, gymAttributesSchema, studyAttributesSchema, moviesAttributesSchema, emptyAttributesSchema]);
export type ActivityAttributes = z.infer<typeof attributesSchema>;
export function attributesForActivity(activityKey: string) {
  switch (activityKey) { case "dota2": return dotaAttributesSchema; case "gym": return gymAttributesSchema; case "study": return studyAttributesSchema; case "movies": return moviesAttributesSchema; default: return emptyAttributesSchema; }
}
const people = z.number().int().min(1).max(12);
const windowSchema = z.object({ startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }) }).strict().refine((v) => Date.parse(v.endAt) > Date.parse(v.startAt), "Укажите время окончания после начала.");
export const searchDraftSchema = z.object({
  seeking: seekingSchema, neededPeople: people, existingPeople: people, attributes: attributesSchema, timezone: timezoneSchema,
}).strict().superRefine((draft, ctx) => {
  const capacity = draft.existingPeople + draft.neededPeople;
  if (capacity > 12) ctx.addIssue({ code: "custom", path: ["neededPeople"], message: "В группе может быть не более 12 человек." });
  if (draft.seeking.groupSize !== null && draft.seeking.groupSize !== capacity) ctx.addIssue({ code: "custom", path: ["seeking", "groupSize"], message: "Размер группы должен соответствовать числу мест." });
  if (draft.seeking.format === "one_to_one" && capacity !== 2) ctx.addIssue({ code: "custom", path: ["neededPeople"], message: "Для встречи вдвоём нужны два места." });
  if (!attributesForActivity(draft.seeking.activityKey).safeParse(draft.attributes).success) ctx.addIssue({ code: "custom", path: ["attributes"], message: "Параметры не соответствуют занятию." });
  draft.seeking.availability.forEach((window, i) => { if (!windowSchema.safeParse(window).success) ctx.addIssue({ code: "custom", path: ["seeking", "availability", i], message: "Некорректное время встречи." }); });
});
export type SearchDraft = z.infer<typeof searchDraftSchema>;
// Incomplete values remain explicit; no artificial availability/city/activity is required.
export const partialSearchDraftSchema = z.object({
  seeking: z.object(seekingSchema.shape).partial().strict(),
  neededPeople: people.optional(), existingPeople: people.optional(), attributes: attributesSchema.optional(), timezone: timezoneSchema,
}).strict().superRefine((draft, ctx) => {
  if (draft.seeking.activityKey && draft.attributes && !attributesForActivity(draft.seeking.activityKey).safeParse(draft.attributes).success) ctx.addIssue({ code: "custom", path: ["attributes"], message: "Параметры не соответствуют занятию." });
  if ((draft.existingPeople ?? 1) + (draft.neededPeople ?? 1) > 12) ctx.addIssue({ code: "custom", path: ["neededPeople"], message: "В группе может быть не более 12 человек." });
});
export type PartialSearchDraft = z.infer<typeof partialSearchDraftSchema>;
const quietHoursSchema = z.object({ startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(0).max(23) }).strict().refine((v) => v.startHour !== v.endHour, "Начало и конец тихих часов должны отличаться.");
const activityPreferenceSchema = z.object({ activityKey: activityKeySchema, attributes: attributesSchema, enabled: z.boolean() }).strict().superRefine((v, ctx) => {
  if (!attributesForActivity(v.activityKey).safeParse(v.attributes).success) ctx.addIssue({ code: "custom", path: ["attributes"], message: "Параметры не соответствуют занятию." });
});
export const preferencesSchema = z.object({ offersEnabled: z.boolean(), timezone: timezoneSchema, quietHours: quietHoursSchema.nullable(), activities: z.array(activityPreferenceSchema).max(12) }).strict().refine((v) => new Set(v.activities.map((a) => a.activityKey)).size === v.activities.length, "Удалите повторяющиеся занятия.");
export type Preference = z.infer<typeof preferencesSchema>;
export function defaultPreferences(timezone = "UTC"): Preference { return preferencesSchema.parse({ offersEnabled: true, timezone, quietHours: null, activities: [] }); }
const referenceDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const date = new Date(`${v}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
}, "Укажите существующую дату.");
export const interpretInputSchema = z.object({ text: boundedText(500), timezone: timezoneSchema, referenceDate: referenceDateSchema, draft: searchDraftSchema.optional(), partialDraft: partialSearchDraftSchema.optional() }).strict().refine((v) => !(v.draft && v.partialDraft), "Передайте один собственный черновик.");
export type InterpretInput = z.infer<typeof interpretInputSchema>;
export const commandSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("stop") }).strict(), z.object({ type: z.literal("extend"), minutes: z.number().int().min(1).max(1440).optional() }).strict()]);
export const preferenceCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("offers"), offersEnabled: z.boolean() }).strict(),
  z.object({ type: z.literal("quiet_hours"), quietHours: quietHoursSchema.nullable() }).strict(),
  z.object({ type: z.literal("activity"), activityKey: activityKeySchema, attributes: attributesSchema }).strict().superRefine((v, ctx) => { if (!attributesForActivity(v.activityKey).safeParse(v.attributes).success) ctx.addIssue({ code: "custom", path: ["attributes"], message: "Параметры не соответствуют занятию." }); }),
]);
export const interpretationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draft"), draft: searchDraftSchema, summary: boundedText(500) }).strict(),
  z.object({ kind: z.literal("clarification"), question: z.object({ field: z.enum(["activity", "time", "city"]), text: boundedText(200), options: z.array(z.object({ label: boundedText(80), value: boundedText(100) }).strict()).max(6) }).strict(), draft: searchDraftSchema.nullable(), partialDraft: partialSearchDraftSchema.optional(), summary: boundedText(500) }).strict(),
  z.object({ kind: z.literal("command"), command: commandSchema, summary: boundedText(500) }).strict(),
  z.object({ kind: z.literal("preference"), preference: preferenceCommandSchema, summary: boundedText(500) }).strict(),
]);
export type Interpretation = z.infer<typeof interpretationSchema>;
const count = z.number().int().min(0).max(1000000);
export const searchSchema = z.object({ publicKey: publicKeySchema, activityLabel: boundedText(80), status: z.enum(["active", "filled", "closed", "expired"]), neededPeople: people, existingPeople: people, capacity: z.number().int().min(2).max(12), joinedCount: count, compatibleCount: count, offeredCount: count, acceptedCount: count, roomKey: publicKeySchema.nullable(), createdAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }), timeHint: boundedText(160), ownDraft: searchDraftSchema.optional() }).strict();
export type SearchDTO = z.infer<typeof searchSchema>;
export const offerSchema = z.object({ publicKey: publicKeySchema, activityLabel: boundedText(80), status: z.enum(["pending", "accepted", "declined", "expired", "cancelled"]), neededPeople: people, timeHint: boundedText(160), attributes: attributesSchema, expiresAt: z.iso.datetime({ offset: true }), roomKey: publicKeySchema.nullable() }).strict();
export type OfferDTO = z.infer<typeof offerSchema>;
const alias = boundedText(60);
const avatarSeed = boundedText(80);
export const roomSchema = z.object({ publicKey: publicKeySchema, activityLabel: boundedText(80), status: z.enum(["forming", "ready", "active", "completed", "archived", "closed"]), capacity: z.number().int().min(2).max(12), joinedCount: count, externalCount: z.number().int().min(0).max(11), isOwner: z.boolean(), members: z.array(z.object({ publicKey: publicKeySchema, alias, avatarSeed, isMine: z.boolean() }).strict()).max(12), planSlug: boundedText(80).regex(/^[A-Za-z0-9_-]+$/).nullable() }).strict();
export type RoomDTO = z.infer<typeof roomSchema>;
export const roomMessageSchema = z.object({ publicKey: publicKeySchema, text: boundedText(2000), createdAt: z.iso.datetime({ offset: true }), isMine: z.boolean(), identity: z.object({ alias, avatarSeed }).strict() }).strict();
export type RoomMessageDTO = z.infer<typeof roomMessageSchema>;
export const searchDTOSchema = searchSchema;
export const offerDTOSchema = offerSchema;
export const roomDTOSchema = roomSchema;
export const roomMessageDTOSchema = roomMessageSchema;
