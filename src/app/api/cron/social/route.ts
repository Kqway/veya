import { getServerEnv } from '@/lib/config/server';
import { getDatabase } from '@/lib/db';
import { createSocialCronHandler } from '@/features/operations/cron';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const GET = createSocialCronHandler({config: getServerEnv, database: getDatabase});
