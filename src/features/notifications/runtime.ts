import 'server-only';
import { getDatabase } from '@/lib/db';
import { getServerEnv } from '@/lib/config/server';
import { runtimeLimiter } from '@/lib/security/rate-limit';
import { createNotificationHandler } from './http';
export function notificationHandler(){const env=getServerEnv();const push=env.PUSH_VAPID_PUBLIC_KEY&&env.PUSH_VAPID_PRIVATE_KEY&&env.PUSH_VAPID_SUBJECT?{publicKey:env.PUSH_VAPID_PUBLIC_KEY,privateKey:env.PUSH_VAPID_PRIVATE_KEY,subject:env.PUSH_VAPID_SUBJECT}:undefined;return createNotificationHandler({origin:env.NEXT_PUBLIC_APP_URL,db:getDatabase,limiter:runtimeLimiter,...(push?{push}:{})});}
