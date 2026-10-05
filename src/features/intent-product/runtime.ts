import 'server-only';
import { getAiTasks } from '@/lib/ai';
import { getDatabase } from '@/lib/db';
import { getServerEnv } from '@/lib/config/server';
import { runtimeLimiter } from '@/lib/security/rate-limit';
import { createIntentProductHandler } from './http';
export function intentProductHandler(){const config=getServerEnv();return createIntentProductHandler({origin:config.NEXT_PUBLIC_APP_URL,db:getDatabase,limiter:runtimeLimiter,analyticsEnabled:config.ANALYTICS_ENABLED,interpret:async input=>(await getAiTasks().interpretConversation(input)).data});}
