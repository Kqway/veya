import {getServerEnv} from '@/lib/config/server';
import {createDatabase} from '@/lib/db/postgres';
import {readAggregateFunnel} from '@/lib/analytics/funnel-report';
async function main(){
 const config=getServerEnv();if(!config.DATABASE_URL)throw new Error('DATABASE_URL is required.');
 if(!config.ANALYTICS_ENABLED)throw new Error('Enable opt-in aggregate analytics before measuring the funnel.');
 const days=process.argv[2]===undefined?7:Number(process.argv[2]);
 const db=createDatabase(config.DATABASE_URL,{max:config.DB_POOL_MAX,...(config.DATABASE_SSL_MODE?{sslMode:config.DATABASE_SSL_MODE}:{})});
 try{console.log(JSON.stringify(await readAggregateFunnel(db,days)));}finally{await db.close();}
}
main().catch(()=>{console.error('Funnel report unavailable. Check analytics opt-in, database configuration and a 1–30 day cohort.');process.exitCode=1;});
