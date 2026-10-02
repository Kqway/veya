import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({fail:false,count:0,options:[] as {connectionString:string;ssl?:{rejectUnauthorized:boolean}}[],clients:[] as {emit:(event:string)=>boolean;ended:boolean}[]}));
vi.mock('pg',()=>({Client:class extends EventEmitter {
 ended=false;
 constructor(options:{connectionString:string;ssl?:{rejectUnauthorized:boolean}}) {super();mock.options.push(options);mock.count++;mock.clients.push(this);}
 async connect() {if(mock.fail) throw new Error('secret connection details');}
 async query() {}
 async end() {this.ended=true;}
}}));
import { EventHub } from '@/features/realtime/hub';
afterEach(()=> {vi.useRealTimers();vi.restoreAllMocks();mock.fail=false;mock.count=0;mock.clients=[];mock.options=[];});
it('bounds listener failure retries and releases all subscriber references',async()=> {
 vi.useFakeTimers();const logged=vi.spyOn(console,'error').mockImplementation(()=>{});
 const hub=new EventHub('postgresql://private-user:private-password@unused/db');const signals:string[]=[];
 await hub.subscribe('a',reason=>signals.push(reason));mock.fail=true;mock.clients[0]!.emit('error');
 await vi.advanceTimersByTimeAsync(100000);
 expect(mock.count).toBe(7);expect(signals).toEqual(['unavailable']);expect(hub.subscriberCount).toBe(0);expect(vi.getTimerCount()).toBe(0);
 await hub.close();expect(mock.clients.every(client=>client.ended)).toBe(true);
 expect(logged).toHaveBeenCalledTimes(1);
 expect(JSON.parse(logged.mock.calls[0]![0] as string)).toEqual({event:'realtime_unavailable',occurrences:1,count:6});
});
it('removing the final recipient cancels a queued listener recovery',async()=> {
 vi.useFakeTimers();const hub=new EventHub('postgresql://unused');
 const off=await hub.subscribe('a',()=>{});mock.clients[0]!.emit('error');expect(vi.getTimerCount()).toBe(1);
 off();off();expect(vi.getTimerCount()).toBe(0);await vi.advanceTimersByTimeAsync(100000);expect(mock.count).toBe(1);await hub.close();
});

it('preserves verified TLS against connection URL options',async()=> {
 const hub=new EventHub('postgresql://unused/db?ssl=false&sslmode=no-verify&sslrootcert=bad&uselibpqcompat=true',{sslMode:'verify-full'});
 await hub.subscribe('a',()=>{});
 expect(mock.options[0]?.ssl).toEqual({rejectUnauthorized:true});
 const url=new URL(mock.options[0]!.connectionString);expect([...url.searchParams]).toEqual([]);
 await hub.close();
});
