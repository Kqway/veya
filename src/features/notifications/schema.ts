import { z } from 'zod';
export const notificationTypeSchema = z.enum(['INTEREST_RECEIVED','INTEREST_ACCEPTED','NEW_MESSAGE','PLAN_READY','MEETUP_REMINDER','CANDIDATE_FOUND','OFFER_RECEIVED','LOBBY_READY','ROOM_MESSAGE','GOAL_APPROVAL','GOAL_RESULT','GOAL_BLOCKER']);
export type NotificationType = z.infer<typeof notificationTypeSchema>;
export const notificationSchema = z.object({
  publicKey:z.string().regex(/^[A-Za-z0-9_-]{24}$/), type:notificationTypeSchema,
  createdAt:z.iso.datetime(), readAt:z.iso.datetime().nullable(),
  href:z.string().regex(/^\/(?:activity|notifications|network\/connections|connections|discover|m\/[A-Za-z0-9_-]{24}|offer\/[A-Za-z0-9_-]{24}|room\/[A-Za-z0-9_-]{24})$/),
}).strict();
export type NotificationDTO = z.infer<typeof notificationSchema>;
const providers=new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
export const pushEndpointSchema=z.string().min(1).max(2048).refine(value=>{
  try {const url=new URL(value);return url.protocol==='https:' && providers.has(url.hostname) && !url.username && !url.password && !url.hash && (!url.port || url.port==='443') && value.startsWith(`https://${url.hostname}`) && url.pathname.length>1;} catch {return false;}
});
export const subscriptionSchema=z.object({endpoint:pushEndpointSchema,keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]{87}$/),auth:z.string().regex(/^[A-Za-z0-9_-]{22}$/)}).strict()}).strict();
export type PushSubscriptionInput=z.infer<typeof subscriptionSchema>;
export type PushConfig={publicKey:string;privateKey:string;subject:string};
