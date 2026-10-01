import 'server-only';
import type {DatabaseExecutor} from '@/lib/db/types';
import {publishSocialEvent} from '@/features/realtime/events';
export async function publishModerationInvalidations(tx:DatabaseExecutor,ids:string[]):Promise<void>{
 const recipients=[...new Set(ids)].sort();
 for(const topic of ['connections','match','notifications','discovery'] as const)for(let offset=0;offset<recipients.length;offset+=100)await publishSocialEvent(tx,recipients.slice(offset,offset+100),{topic});
}
