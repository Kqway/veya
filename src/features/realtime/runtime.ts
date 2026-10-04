import 'server-only';
import { after } from 'next/server';
import { getDatabase } from '@/lib/db';
import { getServerEnv } from '@/lib/config/server';
import { runtimeLimiter } from '@/lib/security/rate-limit';
import { EventHub } from './hub';
import { createRealtimeHandler } from './http';
let hub:EventHub|undefined;
let vercelHub:{hub:EventHub;requests:number}|undefined;
export function realtimeHandler(request:Request):Promise<Response> {
 const config=getServerEnv();
 if(!config.REALTIME_ENABLED) return Promise.resolve(new Response(null,{status:503}));
 const url=config.REALTIME_DATABASE_URL ?? config.DATABASE_URL;
 if(!url || !/^postgres(?:ql)?:\/\//.test(url)) return Promise.resolve(new Response(null,{status:503}));
 if(config.VERCEL==='1') {
  // Count requests before any async authorization/subscription work: the listener
  // cannot be closed while another response is still preparing its subscription.
  const active=vercelHub??={hub:new EventHub(url,config.DATABASE_SSL_MODE ? {sslMode:config.DATABASE_SSL_MODE}:{}),requests:0};
  active.requests++;
  let released=false;
  after(async()=> {
   if(released)return;released=true;
   active.requests--;
   if(active.requests===0 && vercelHub===active) {
    // Detach synchronously, before awaiting close, so a new request gets a fresh hub.
    vercelHub=undefined;
    await active.hub.close();
   }
  });
  return createRealtimeHandler({db:getDatabase(),hub:active.hub,limiter:runtimeLimiter,lifetimeMs:240_000})(request);
 }
 hub ??=new EventHub(url,config.DATABASE_SSL_MODE ? {sslMode:config.DATABASE_SSL_MODE}:{});
 return createRealtimeHandler({db:getDatabase(),hub,limiter:runtimeLimiter})(request);
}
export async function closeRealtimeRuntime():Promise<void> {
 const active=hub,serverless=vercelHub;hub=undefined;vercelHub=undefined;
 await Promise.all([active?.close(),serverless?.hub.close()]);
}
