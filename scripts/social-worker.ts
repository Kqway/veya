import {createDatabase} from '@/lib/db/postgres';
import type {Database} from '@/lib/db/types';
import {getServerEnv} from '@/lib/config/server';
import {getBetaControls} from '@/lib/config/beta-policy';
import {processIntentJobs} from '@/features/intent-product/worker';
import {processCandidateJobs} from '@/features/discovery/candidate-jobs';
import {processNotificationJobs} from '@/features/notifications/jobs';
import {runOperation} from '@/lib/logging/operation';
import {logOperationalEvent} from '@/lib/logging/server';
let db:Database|undefined;
process.exitCode=await runOperation('worker',async signal=>{
 if(process.argv.length>2)throw new Error('This bounded worker takes no arguments.');
 const config=getServerEnv();
 if(getBetaControls().readOnly){logOperationalEvent('worker_skipped');return;}
 if(!config.DATABASE_URL)throw new Error('DATABASE_URL is required.');
 db=createDatabase(config.DATABASE_URL,{max:config.DB_POOL_MAX,...(config.DATABASE_SSL_MODE?{sslMode:config.DATABASE_SSL_MODE}:{})});
 const push=config.PUSH_VAPID_PUBLIC_KEY&&config.PUSH_VAPID_PRIVATE_KEY&&config.PUSH_VAPID_SUBJECT&&new URL(config.NEXT_PUBLIC_APP_URL).protocol==='https:'?{publicKey:config.PUSH_VAPID_PUBLIC_KEY,privateKey:config.PUSH_VAPID_PRIVATE_KEY,subject:config.PUSH_VAPID_SUBJECT}:undefined;
 const intents=await processIntentJobs(db,{limit:20,signal,analyticsEnabled:config.ANALYTICS_ENABLED});
 logOperationalEvent('worker_complete',intents);
 const candidates=await processCandidateJobs(db,{limit:20,signal});
 logOperationalEvent('worker_complete',candidates);
 const notifications=await processNotificationJobs(db,{limit:20,signal,...(push?{push}:{})});
 logOperationalEvent('worker_complete',notifications);
 if(intents.failed||candidates.failed||notifications.failed)logOperationalEvent('worker_failed',{count:intents.failed+candidates.failed+notifications.failed});
},async()=>{await db?.close();});
if(process.exitCode===1)console.error('Social worker unavailable. Check database migrations and server configuration.');
