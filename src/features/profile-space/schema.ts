import { z } from 'zod';
import { identitySchema } from '@/features/social/privacy';
import { publicKeySchema } from '@/features/social/seeking-schema';
export const PROFILE_WORLDS = ['minimal','midnight','glass','cozy','cyber','manga','y2k','monochrome'] as const;
export const ACCENTS = ['coral','mint','violet','amber','blue'] as const;
export const AVATARS = ['orbit','arch','spark','grid'] as const;
export const BLOCKS = ['intent','activities','interests','goals'] as const;
export const VISIBILITY = ['self','connection','everyone'] as const;
const text = (max:number)=>z.string().trim().max(max).refine(value=>!value.includes('\0'));
const distinct = <T>(items:T[])=>new Set(items).size===items.length;
const block = z.enum(BLOCKS);
const visibility = z.enum(VISIBILITY);
const activityKey = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/);
export const customizationSchema = z.object({
 world:z.enum(PROFILE_WORLDS),accent:z.enum(ACCENTS),avatar:z.enum(AVATARS),
 status:text(60),tagline:text(120),
 interests:z.array(text(30).min(1)).max(8).refine(distinct),
 goals:z.array(text(80).min(1)).max(3).refine(distinct),
 selectedActivities:z.array(activityKey).max(6).refine(distinct),
 intentPostKey:publicKeySchema.nullable(),
 enabledBlocks:z.array(block).max(4).refine(distinct),
 blockOrder:z.array(block).length(4).refine(distinct),
 visibility:z.object({status:visibility,tagline:visibility,intent:visibility,activities:visibility,interests:visibility,goals:visibility}).strict(),
}).strict();
export type Customization = z.infer<typeof customizationSchema>;
export function defaultCustomization():Customization {
 return {world:'minimal',accent:'coral',avatar:'orbit',status:'',tagline:'',interests:[],goals:[],selectedActivities:[],intentPostKey:null,enabledBlocks:[...BLOCKS],blockOrder:[...BLOCKS],visibility:{status:'self',tagline:'self',intent:'everyone',activities:'self',interests:'self',goals:'self'}};
}
export const presentationSchema=z.object({world:z.enum(PROFILE_WORLDS),accent:z.enum(ACCENTS),avatar:z.enum(AVATARS)}).strict();
export const currentIntentSchema=z.object({activityLabel:text(80).min(1),interactionMode:z.enum(['in_person','online','either']),format:z.enum(['one_to_one','group','either']),timeHint:text(80).nullable()}).strict();
export const activitySummarySchema=z.object({activityKey,activityLabel:text(80).min(1),count:z.number().int().nonnegative().max(1000000)}).strict();
export const profileSpaceSchema=z.object({
 identity:identitySchema,audience:z.enum(['self','stranger','connection']),presentation:presentationSchema,
 status:text(60).nullable(),tagline:text(120).nullable(),currentIntent:currentIntentSchema.nullable(),
 activities:z.array(activitySummarySchema).max(6),interests:z.array(text(30)).max(8),goals:z.array(text(80)).max(3),
 blockOrder:z.array(block).max(4).refine(distinct),
 action:z.object({kind:z.enum(['seek','interest','connections','chat','none']),key:publicKeySchema.nullable()}).strict(),
 customization:customizationSchema.optional(),
 intentOptions:z.array(z.object({publicKey:publicKeySchema,activityLabel:text(80).min(1)}).strict()).max(3).optional(),
 activityOptions:z.array(activitySummarySchema).max(20).optional(),
}).strict();
export type ProfileSpace=z.infer<typeof profileSpaceSchema>;
export type Presentation=z.infer<typeof presentationSchema>;
export type CurrentIntent=z.infer<typeof currentIntentSchema>;
export type ActivitySummary=z.infer<typeof activitySummarySchema>;
