import {createDatabase} from '@/lib/db/postgres';
import type {Database} from '@/lib/db/types';
import {isDatabaseReady} from '@/lib/db';
import {applyMigrations} from '@/lib/db/migrations';
import {seedDemo} from '@/lib/db/seed';
import {getServerEnv} from '@/lib/config/server';
import {runOperation} from '@/lib/logging/operation';
import {logOperationalEvent} from '@/lib/logging/server';
let database:Database|undefined;
process.exitCode=await runOperation('migration',async()=>{
 const command=process.argv[2];
 if(process.argv.length!==3||!['migrate','seed','verify'].includes(command??''))throw new Error('Unknown database command.');
 const config=getServerEnv();
 if(config.NODE_ENV==='production'&&(!config.DATABASE_URL||command==='seed'))throw new Error('Production requires DATABASE_URL; demo seeding is disabled in production.');
 database=createDatabase(config.DATABASE_URL??'postgresql://veya:veya-local-only@127.0.0.1:54322/veya',{max:config.DB_POOL_MAX,...(config.DATABASE_SSL_MODE?{sslMode:config.DATABASE_SSL_MODE}:{})});
 if(command==='verify'){
  if(!await isDatabaseReady(database))throw new Error('Database schema is not ready.');
  return;
 }
 const applied=await applyMigrations(database);
 logOperationalEvent('migration_complete',{count:applied.length});
 if(command==='seed'){
  const demo=await seedDemo(database);
  console.log(`Demo ${demo.created?'created':'already exists'}: /api/intents/${demo.publicSlug}`);
 }
},async()=>{await database?.close();});
if(process.exitCode===1)console.error('Database command failed. Verify DATABASE_URL, PostgreSQL availability and migration checksums. Demo seeding is disabled in production.');
