import 'server-only';
import { createHash } from 'node:crypto';
import type { loadMigrations } from './migrations';

type Migrations = Awaited<ReturnType<typeof loadMigrations>>;

// Dollar tags must be absent from their contents, including nested SQL/functions.
function quoted(value: string, label: string) {
 let index=0;
 while(value.includes(`$${label}_${index}$`)) index++;
 const tag=`$${label}_${index}$`;
 return `${tag}${value}${tag}`;
}

/** Offline generator for the known18→20 release. No DB/env/credentials are read.
 * Never run during web build/startup. The operator chooses the target and backup. */
export function buildConsoleUpgrade(migrations: Migrations) {
 if(migrations.length!==20 || Array.from(migrations).some((m,index)=>
  !m || !new RegExp(`^${String(index+1).padStart(4,'0')}_[a-z0-9_]+\\.sql$`).test(m.version) ||
  m.checksum!==createHash('sha256').update(m.sql).digest('hex')) ||
  migrations[18]?.version!=='0019_profile_spaces.sql' || migrations[19]?.version!=='0020_intent_lobbies.sql') {
  throw new Error('Invalid release migrations');
 }
 // Only validated source filenames and hex digests enter these SQL literals.
 // Personal data and client-supplied values are never part of this generator.
 const expected=migrations.map((m,index)=>`(${index+1},'${m.version}','${m.checksum}')`).join(',\n');
 const mismatch=(count: string)=>`EXISTS (
  SELECT 1 FROM (VALUES\n${expected}) AS expected(ordinal,version,checksum)
  FULL JOIN public.veya_schema_migrations AS actual ON actual.version=expected.version
  WHERE expected.version IS NULL
   OR (expected.ordinal<=${count} AND actual.version IS NULL)
   OR (actual.version IS NOT NULL AND actual.checksum IS DISTINCT FROM expected.checksum)
 )`;
 const apply=migrations.slice(18).map((m,index)=>`
  EXECUTE ${quoted(m.sql,`intavro_migration_${index+19}`)};
  INSERT INTO public.veya_schema_migrations(version,checksum) VALUES('${m.version}','${m.checksum}');
 `).join('\n');
 const body=`
 DECLARE current_count integer;
 BEGIN
  -- pg_catalog is implicitly searched first; public remains the DDL target.
  PERFORM pg_catalog.set_config('search_path','public',true);
  PERFORM pg_catalog.set_config('lock_timeout','10s',true);
  PERFORM pg_catalog.pg_advisory_xact_lock(782014221);
  IF pg_catalog.to_regclass('public.veya_schema_migrations') IS NULL THEN
   RAISE EXCEPTION 'Unsupported migration history';
  END IF;
  SELECT count(*) INTO current_count FROM public.veya_schema_migrations;
  IF current_count NOT IN (18,20) OR ${mismatch('current_count')} THEN
   RAISE EXCEPTION 'Unsupported migration history';
  END IF;
  IF current_count=18 THEN ${apply}
  END IF;
  IF (SELECT count(*) FROM public.veya_schema_migrations)<>20 OR ${mismatch('20')} THEN
   RAISE EXCEPTION 'Unsupported migration history';
  END IF;
 END
 `;
 return {
  upgrade:`-- Intavro18→20. Run only after protected backup/test restore and maintenance.\n-- One atomic statement for Neon Query Editor; repeated verified20 runs do no DDL.\nDO ${quoted(body,'intavro_upgrade')};\n`,
  verify:`-- Read-only verification. Run separately from the upgrade statement.\nSELECT (count(*)=20 AND NOT ${mismatch('20')}) AS verified,count(*)::integer AS migration_count\nFROM public.veya_schema_migrations;\n`,
 };
}
