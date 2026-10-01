import{afterAll,beforeAll,expect,it}from'vitest';
import{startTestDatabase}from'../support/postgres';
import{applyMigrations}from'@/lib/db/migrations';
import{socialActor}from'../support/social';
import{processCandidateJobs}from'@/features/discovery/candidate-jobs';
import{NotificationService}from'@/features/notifications/service';
let c:Awaited<ReturnType<typeof startTestDatabase>>;
beforeAll(async()=>{c=await startTestDatabase();await applyMigrations(c.db);});afterAll(async()=>{if(c)await c.stop();});
it('saved seeking automatically queues real future-candidate work without creating requests',async()=>{
 const a=await socialActor(c.db,'Future-A');
 expect((await c.db.query('SELECT * FROM social_candidate_jobs')).rows).toHaveLength(1);
 await processCandidateJobs(c.db);expect((await new NotificationService(c.db).list(a.token)).notifications).toEqual([]);
 const b=await socialActor(c.db,'Future-B');await processCandidateJobs(c.db);
 for(const actor of[a,b])expect((await new NotificationService(c.db).list(actor.token)).notifications.map(n=>n.type)).toEqual(['CANDIDATE_FOUND']);
 expect((await c.db.query('SELECT * FROM connection_requests')).rows).toEqual([]);
 await processCandidateJobs(c.db);expect((await new NotificationService(c.db).list(a.token)).notifications).toHaveLength(1);
});
