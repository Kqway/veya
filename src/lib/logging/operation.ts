import 'server-only';
import {logOperationalEvent} from './server';

/** CLI lifecycle only. Finish the current transaction, stop further work, and bound resource draining. */
export async function runOperation(
 kind:'worker'|'migration'|'retention'|'status',
 work:(signal:AbortSignal)=>Promise<void>,
 close:()=>Promise<void>,
 options:{timeoutMs?:number;graceMs?:number;cleanupMs?:number}={},
):Promise<number>{
 const controller=new AbortController(),started=Date.now();
 const graceMs=options.graceMs??10_000,cleanupMs=options.cleanupMs??5_000;
 let exitCode=0,forced=false,deadline:ReturnType<typeof setTimeout>|undefined;
 let expire!:()=>void;
 const expired=new Promise<void>(resolve=>{expire=resolve;});
 const stop=(code:number)=>{
  if(controller.signal.aborted)return;
  exitCode=code;controller.abort();logOperationalEvent(`${kind}_interrupted`);
  deadline=setTimeout(()=>{forced=true;expire();},graceMs);
 };
 const terminate=()=>stop(143),interrupt=()=>stop(130);
 process.on('SIGTERM',terminate);process.on('SIGINT',interrupt);
 const timeout=setTimeout(()=>stop(1),options.timeoutMs??240_000);
 logOperationalEvent(`${kind}_started`);
 try{
  await Promise.race([Promise.resolve().then(()=>work(controller.signal)),expired]);
  if(forced){exitCode=exitCode||1;logOperationalEvent(`${kind}_failed`);}
  else if(!controller.signal.aborted)logOperationalEvent(`${kind}_complete`,{durationMs:Date.now()-started});
 }catch{exitCode=1;logOperationalEvent(`${kind}_failed`);}
 finally{
  clearTimeout(timeout);if(deadline)clearTimeout(deadline);
  let cleanupTimer:ReturnType<typeof setTimeout>|undefined;
  try{
   const cleaned=await Promise.race([
    Promise.resolve().then(close).then(()=>true),
    new Promise<false>(resolve=>{cleanupTimer=setTimeout(()=>resolve(false),cleanupMs);}),
   ]);
   if(!cleaned){forced=true;exitCode=1;logOperationalEvent('shutdown_failed');}
  }catch{forced=true;exitCode=1;logOperationalEvent('shutdown_failed');}
  finally{if(cleanupTimer)clearTimeout(cleanupTimer);process.off('SIGTERM',terminate);process.off('SIGINT',interrupt);}
 }
 logOperationalEvent(`${kind}_exit`,{durationMs:Date.now()-started,exitCode});
 // Unresolved owners can keep sockets/timers alive even after our drain deadline.
 if(forced)process.exit(exitCode||1);
 return exitCode;
}
