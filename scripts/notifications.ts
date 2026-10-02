import {createDatabase} from '@/lib/db/postgres';
import type {Database} from '@/lib/db/types';
import {getServerEnv} from '@/lib/config/server';
import {getBetaControls} from '@/lib/config/beta-policy';
import {processNotificationJobs} from '@/features/notifications/jobs';
import {runOperation} from '@/lib/logging/operation';
import {logOperationalEvent} from '@/lib/logging/server';
let db:Database|undefined;
process.exitCode=await runOperation('worker',async signal=>{
 const args=process.argv.slice(2);
 if(args.length>1||args.some(arg=>!/^--limit=\d{1,3}$/.test(arg)))throw new Error('Use --limit=1..100.');
 const limit=args[0]?Number(args[0].split('=')[1]):20;
 if(limit<1||limit>100)throw new Error('Use --limit=1..100.');
 const env=getServerEnv();
 if(getBetaControls().readOnly){logOperationalEvent('worker_skipped');return;}
 if(env.NODE_ENV==='production'&&!env.DATABASE_URL)throw new Error('Production requires DATABASE_URL.');
 db=createDatabase(env.DATABASE_URL??'postgresql://veya:veya-local-only@127.0.0.1:54322/veya',{max:env.DB_POOL_MAX,...(env.DATABASE_SSL_MODE?{sslMode:env.DATABASE_SSL_MODE}:{})});
 const push=env.PUSH_VAPID_PUBLIC_KEY&&env.PUSH_VAPID_PRIVATE_KEY&&env.PUSH_VAPID_SUBJECT&&new URL(env.NEXT_PUBLIC_APP_URL).protocol==='https:'?{publicKey:env.PUSH_VAPID_PUBLIC_KEY,privateKey:env.PUSH_VAPID_PRIVATE_KEY,subject:env.PUSH_VAPID_SUBJECT}:undefined;
 const result=await processNotificationJobs(db,{limit,signal,...(push?{push}:{})});
 logOperationalEvent('worker_complete',result);
 if(result.failed)logOperationalEvent('worker_failed',{count:result.failed});
},async()=>{await db?.close();});
if(process.exitCode===1)console.error('Notification worker failed. Check configuration and database migrations.');
