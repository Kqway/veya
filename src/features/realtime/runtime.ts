import 'server-only';
import { getDatabase } from '@/lib/db';
import { getServerEnv } from '@/lib/config/server';
import { runtimeLimiter } from '@/lib/security/rate-limit';
import { EventHub } from './hub';
import { createRealtimeHandler } from './http';
let hub:EventHub|undefined;
export function realtimeHandler(request:Request):Promise<Response> {
 const config=getServerEnv();
 if(!config.REALTIME_ENABLED) return Promise.resolve(new Response(null,{status:503}));
 const url=config.REALTIME_DATABASE_URL ?? config.DATABASE_URL;
 if(!url || !/^postgres(?:ql)?:\/\//.test(url)) return Promise.resolve(new Response(null,{status:503}));
 hub ??=new EventHub(url,config.DATABASE_SSL_MODE ? {sslMode:config.DATABASE_SSL_MODE}:{});
 return createRealtimeHandler({db:getDatabase(),hub,limiter:runtimeLimiter})(request);
}
export async function closeRealtimeRuntime():Promise<void> {const active=hub;hub=undefined;await active?.close();}
