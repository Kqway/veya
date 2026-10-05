import {cleanupIntentData} from '@/lib/db/intent-retention';
import {cleanupReleaseData} from '@/lib/db/release-retention';
import {createDatabase} from '@/lib/db/postgres';
import type {Database} from '@/lib/db/types';
import {cleanupSocial} from '@/lib/db/social-retention';
import {cleanupExpired} from '@/lib/db/retention';
import {getServerEnv} from '@/lib/config/server';
import {getBetaControls} from '@/lib/config/beta-policy';
import {runOperation} from '@/lib/logging/operation';
import {logOperationalEvent} from '@/lib/logging/server';
let database:Database|undefined;
process.exitCode=await runOperation('retention',async signal=>{
 const args=process.argv.slice(2);
 if(args.length>1||args.some(arg=>arg!=='--apply'&&arg!=='--dry-run'))throw new Error('Use --dry-run or --apply.');
 const apply=args.includes('--apply'),config=getServerEnv();
 if(apply&&getBetaControls().readOnly){logOperationalEvent('retention_skipped');return;}
 if(config.NODE_ENV==='production'&&!config.DATABASE_URL)throw new Error('Production requires DATABASE_URL.');
 database=createDatabase(config.DATABASE_URL??'postgresql://veya:veya-local-only@127.0.0.1:54322/veya',{max:config.DB_POOL_MAX,...(config.DATABASE_SSL_MODE?{sslMode:config.DATABASE_SSL_MODE}:{})});
 const release=await cleanupReleaseData(database,{apply,signal});
 const action=await cleanupIntentData(database,{apply,signal});
 const social=await cleanupSocial(database,{apply,signal});
 const result=await cleanupExpired(database,{apply,signal});
 // These domain results contain only category counts and a dry-run boolean.
 console.log(JSON.stringify({release,action,social,coordination:result}));
},async()=>{await database?.close();});
if(process.exitCode===1)console.error('Retention command failed. Check database availability/migrations and use --dry-run or --apply. Production requires explicit DATABASE_URL.');
