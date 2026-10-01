import{createDatabase}from'@/lib/db/postgres';
import{getServerEnv}from'@/lib/config/server';
import{processCandidateJobs}from'@/features/discovery/candidate-jobs';
import{processNotificationJobs}from'@/features/notifications/jobs';
async function main(){
 const config=getServerEnv();if(!config.DATABASE_URL)throw new Error('DATABASE_URL is required.');
 if(process.argv.length>2)throw new Error('This bounded worker takes no arguments.');
 const db=createDatabase(config.DATABASE_URL,{max:config.DB_POOL_MAX,...(config.DATABASE_SSL_MODE?{sslMode:config.DATABASE_SSL_MODE}:{})});
 const push=config.PUSH_VAPID_PUBLIC_KEY&&config.PUSH_VAPID_PRIVATE_KEY&&config.PUSH_VAPID_SUBJECT&&new URL(config.NEXT_PUBLIC_APP_URL).protocol==='https:'?{publicKey:config.PUSH_VAPID_PUBLIC_KEY,privateKey:config.PUSH_VAPID_PRIVATE_KEY,subject:config.PUSH_VAPID_SUBJECT}:undefined;
 try{
  const candidates=await processCandidateJobs(db,{limit:20});
  const notifications=await processNotificationJobs(db,{limit:20,...(push?{push}:{})});
  console.log(JSON.stringify({candidates,notifications}));
 }finally{await db.close();}
}
main().catch(()=>{console.error('Social worker unavailable. Check database migrations and server configuration.');process.exitCode=1;});
