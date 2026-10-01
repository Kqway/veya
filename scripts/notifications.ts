import { createDatabase } from '@/lib/db/postgres';
import { getServerEnv } from '@/lib/config/server';
import { processNotificationJobs } from '@/features/notifications/jobs';
async function main(){
  const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!/^--limit=\d{1,3}$/.test(arg)))throw new Error('Use --limit=1..100.');
  const env=getServerEnv();if(env.NODE_ENV==='production'&&!env.DATABASE_URL)throw new Error('Production requires DATABASE_URL.');
  const db=createDatabase(env.DATABASE_URL??'postgresql://veya:veya-local-only@127.0.0.1:54322/veya',{max:env.DB_POOL_MAX,...(env.DATABASE_SSL_MODE?{sslMode:env.DATABASE_SSL_MODE}:{})});
  const push=env.PUSH_VAPID_PUBLIC_KEY&&env.PUSH_VAPID_PRIVATE_KEY&&env.PUSH_VAPID_SUBJECT&&new URL(env.NEXT_PUBLIC_APP_URL).protocol==='https:'?{publicKey:env.PUSH_VAPID_PUBLIC_KEY,privateKey:env.PUSH_VAPID_PRIVATE_KEY,subject:env.PUSH_VAPID_SUBJECT}:undefined;
  try{const result=await processNotificationJobs(db,{limit:args[0]?Number(args[0].split('=')[1]):20,...(push?{push}:{})});console.log(JSON.stringify(result));}finally{await db.close();}
}
main().catch(()=>{console.error('Notification worker failed. Check configuration and database migrations.');process.exitCode=1;});
