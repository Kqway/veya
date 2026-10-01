import { describe,expect,it,vi } from 'vitest';
import { createNotificationHandler } from '@/features/notifications/http';
describe('notification HTTP privacy and early limits',()=>{
 it('checks origin and shared push budget before body or database construction',async()=>{
  const db=vi.fn(()=>{throw new Error('database must not open');});const check=vi.fn(async()=>({allowed:false,retryAfterSeconds:2}));const handler=createNotificationHandler({origin:'https://veya.test',db,limiter:{check}});
  const request=new Request('https://veya.test/api/notifications/push',{method:'POST',headers:{origin:'https://veya.test','content-type':'application/json'},body:'broken-json'});
  const response=await handler(request,['push']);expect(response.status).toBe(429);expect(check).toHaveBeenCalledWith('push','');expect(db).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toBe('no-store');
  const rejected=await handler(new Request('https://veya.test/api/notifications/push',{method:'DELETE',headers:{origin:'https://other.test'}}),['push']);expect(rejected.status).toBe(403);expect(db).not.toHaveBeenCalled();
 });
 it('rejects invalid cursor and unknown routes without opening database',async()=>{
  const db=vi.fn(()=>{throw new Error('database must not open');});const handler=createNotificationHandler({origin:'https://veya.test',db});
  expect((await handler(new Request('https://veya.test/api/notifications?before=uuid'),[])).status).toBe(400);expect((await handler(new Request('https://veya.test/api/notifications/forged'),['forged'])).status).toBe(404);expect(db).not.toHaveBeenCalled();
 });
});
