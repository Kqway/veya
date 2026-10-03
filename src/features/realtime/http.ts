import 'server-only';
import type { Database } from '@/lib/db/types';
import type { RequestLimiter } from '@/lib/security/rate-limit';
import { apiError, enforceRateLimit, json, tokenFrom } from '@/features/backend/http';
import { requireProfile } from '@/features/social/context';
import { SocialError } from '@/features/social/errors';
import { EventHub, type HubReason } from './hub';
import { latestSocialCursor, readSocialEvents } from './events';
export function createRealtimeHandler(options: {db:Database;hub:EventHub;limiter?:RequestLimiter;heartbeatMs?:number;lifetimeMs?:number;bufferBytes?:number}) {
 return async (request: Request): Promise<Response> => {
  try {
   if (request.method!=='GET') return json({error:{code:'METHOD_NOT_ALLOWED',message:'Используйте метод GET.'}},405);
   const url=new URL(request.url);
   if ([...url.searchParams.keys()].some(key=>key!=='cursor') || url.searchParams.getAll('cursor').length>1) return json({error:{code:'INVALID_INPUT',message:'Некорректные параметры подписки.'}},400);
   const requestedCursor=request.headers.get('last-event-id') ?? url.searchParams.get('cursor') ?? undefined;
   if (requestedCursor && !/^[A-Za-z0-9_-]{24}$/.test(requestedCursor)) return json({error:{code:'INVALID_INPUT',message:'Некорректный курсор.'}},400);
   await enforceRateLimit(options.limiter,'realtime',request);
   const token=tokenFrom(request),profile=await requireProfile(options.db,token);
   let closed=false,unsubscribe:(()=>void)|undefined,heartbeat:ReturnType<typeof setInterval>|undefined,lifetime:ReturnType<typeof setTimeout>|undefined;
   let controller:ReadableStreamDefaultController<Uint8Array>|undefined;
   let cursor=requestedCursor,initial=true,pending=false,pendingSync=false,flushing=false;
   const encoder=new TextEncoder();
   const cleanup=()=> {
    if(closed) return; closed=true; unsubscribe?.(); unsubscribe=undefined;
    if(heartbeat) clearInterval(heartbeat); if(lifetime) clearTimeout(lifetime);
    request.signal.removeEventListener('abort',finish);
   };
   const finish=()=> {cleanup(); try {controller?.close();} catch { /* Already cancelled. */ } };
   const frame=(event:string,data:unknown,id?:string)=> {
    if(closed || !controller) return;
    if((controller.desiredSize ?? 0)<=0) {finish(); return;}
    controller.enqueue(encoder.encode(`${id ? `id: ${id}\n`:''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
   };
   const authorize=async()=> {
    const current=await requireProfile(options.db,token);
    if(current.id!==profile.id) throw new SocialError('UNAUTHORIZED');
   };
   const flush=async()=> {
    if(closed || !controller || flushing) return;
    flushing=true;
    try {
     while(pending && !closed) {
      pending=false;
      const sync=initial || pendingSync; pendingSync=false;
      await authorize();
      const page=await readSocialEvents(options.db,profile.id,cursor);
      const latest=await latestSocialCursor(options.db,profile.id);
      await authorize();
      if(closed) break;
      if((sync && !(initial && page.cursorValid && !page.overflow)) || (cursor && !page.cursorValid) || page.overflow) {
       // Persistent APIs reconstruct all state even when outbox history was pruned.
       frame('sync',{},latest); cursor=latest;
      } else {
       if(initial) frame('sync',{},cursor);
       // One chunk per bounded batch keeps slow readers from growing memory.
       const frames=page.events.map(event=> {
        const {publicKey,...data}=event;
        return `id: ${publicKey}\nevent: invalidate\ndata: ${JSON.stringify(data)}\n\n`;
       }).join('');
       if(frames) {
        if((controller.desiredSize ?? 0)<=0) {finish(); break;}
        controller.enqueue(encoder.encode(frames)); cursor=page.events.at(-1)?.publicKey;
       }
      }
      initial=false;
     }
    } catch {finish();} finally {flushing=false;}
   };
   const notify=(reason:HubReason)=> {
    if(reason==='unavailable') {finish(); return;}
    if(reason==='sync') pendingSync=true;
    pending=true; void flush();
   };
   try {unsubscribe=await options.hub.subscribe(profile.id,notify);} catch {return json({error:{code:'UNAVAILABLE',message:'Обновления в реальном времени недоступны.'}},503);}
   if(request.signal.aborted || closed) {cleanup(); return new Response(null,{status:204});}
   const stream=new ReadableStream<Uint8Array>({
    start(current) {
     controller=current; request.signal.addEventListener('abort',finish,{once:true});
     pending=true; void flush();
     let checking=false;
     heartbeat=setInterval(()=> {
      if(checking || closed || flushing) return; checking=true;
      void authorize().then(()=> {
       if(!closed && controller && (controller.desiredSize ?? 0)>0) controller.enqueue(encoder.encode(': heartbeat\n\n'));
       else if(!closed) finish();
      }).catch(finish).finally(()=> {checking=false;});
     },options.heartbeatMs ?? 15000);
     lifetime=setTimeout(finish,options.lifetimeMs ?? 5*60*1000);
     heartbeat.unref?.(); lifetime.unref?.();
    },cancel() {cleanup();},
   },{highWaterMark:options.bufferBytes ?? 65536,size:chunk=>chunk.byteLength});
   return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'}});
  } catch(error) {
   if(error instanceof SocialError) return json({error:{code:error.code,message:error.message}},error.status);
   return apiError(error);
  }
 };
}
