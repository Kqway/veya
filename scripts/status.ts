import {createDatabase} from '@/lib/db/postgres';
import type {Database} from '@/lib/db/types';
import {getServerEnv} from '@/lib/config/server';
import {isDatabaseReady} from '@/lib/db';
import {readOperationalStatus} from '@/lib/db/operational-status';
import {runOperation} from '@/lib/logging/operation';
let db:Database|undefined;
process.exitCode=await runOperation('status',async()=>{
 const env=getServerEnv();
 if(process.argv.length!==2||!env.DATABASE_URL)throw new Error('Status requires DATABASE_URL and no arguments.');
 db=createDatabase(env.DATABASE_URL,{max:1,...(env.DATABASE_SSL_MODE?{sslMode:env.DATABASE_SSL_MODE}:{})});
 if(!await isDatabaseReady(db))throw new Error('Schema unavailable.');
 console.log(JSON.stringify(await readOperationalStatus(db)));
},async()=>{await db?.close();});
