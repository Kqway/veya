import 'server-only';
import { Client } from 'pg';
export type HubReason = 'change' | 'sync' | 'unavailable';
type Subscriber = (reason: HubReason) => void;
/** One session-mode LISTEN connection per process; NOTIFY never leaves the server. */
export class EventHub {
 private subscribers = new Map<string, Set<Subscriber>>();
 private client: Client | undefined;
 private connecting: Promise<void> | undefined;
 private retry: ReturnType<typeof setTimeout> | undefined;
 private attempts = 0;
 private stopped = false;
 private recovering = false;
 constructor(private readonly url: string, private readonly options: {retryBaseMs?:number;maxSubscribers?:number;maxPerProfile?:number;sslMode?:'verify-full'} = {}) {}
 get subscriberCount() { let count=0; for (const set of this.subscribers.values()) count+=set.size; return count; }
 async subscribe(id: string, fn: Subscriber): Promise<()=>void> {
  if (this.stopped || this.subscriberCount >= (this.options.maxSubscribers ?? 1000) || (this.subscribers.get(id)?.size ?? 0) >= (this.options.maxPerProfile ?? 3)) throw new Error('Realtime capacity unavailable');
  await this.connect();
  if (this.subscriberCount >= (this.options.maxSubscribers ?? 1000) || (this.subscribers.get(id)?.size ?? 0) >= (this.options.maxPerProfile ?? 3)) throw new Error('Realtime capacity unavailable');
  if (this.stopped) throw new Error('Realtime stopped');
  const set=this.subscribers.get(id) ?? new Set<Subscriber>();
  set.add(fn); this.subscribers.set(id,set);
  let active=true;
  return ()=> { if (!active) return; active=false; set.delete(fn); if (!set.size) this.subscribers.delete(id); if (!this.subscriberCount && this.retry) { clearTimeout(this.retry); this.retry=undefined; } };
 }
 private emit(id: string, reason: HubReason) { for (const fn of [...(this.subscribers.get(id) ?? [])]) { try { fn(reason); } catch { /* A stream cannot interrupt other recipients. */ } } }
 private all(reason: HubReason) { for(const id of this.subscribers.keys()) this.emit(id,reason); }
 private connect(): Promise<void> {
  if (this.client) return Promise.resolve();
  if (this.connecting) return this.connecting;
  let connectionString=this.url;
  if(this.options.sslMode==='verify-full') {const parsed=new URL(connectionString);for(const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat']) parsed.searchParams.delete(key);connectionString=parsed.toString();}
  const client=new Client({connectionString,...(this.options.sslMode==='verify-full' ? {ssl:{rejectUnauthorized:true}}:{}),application_name:'veya-social-listener',connectionTimeoutMillis:5000,keepAlive:true});
  // Install before connect: pg reports socket loss as an EventEmitter error.
  client.on('error',()=>this.lost(client));
  client.on('end',()=>this.lost(client));
  client.on('notification',message=> { if (message.channel==='veya_social_events' && message.payload && /^[a-f0-9-]{36}$/.test(message.payload)) this.emit(message.payload,'change'); });
  this.connecting=(async()=> {
   try {
    await client.connect(); await client.query('LISTEN veya_social_events');
    if (this.stopped) { await client.end(); return; }
    this.client=client; this.attempts=0;
    if(this.retry) {clearTimeout(this.retry);this.retry=undefined;}
    if (this.recovering) { this.recovering=false; this.all('sync'); }
   } catch { await client.end().catch(()=>{}); throw new Error('Realtime listener unavailable'); }
   finally { this.connecting=undefined; }
  })();
  return this.connecting;
 }
 private lost(client: Client) {
  if (this.client!==client || this.stopped) return;
  this.client=undefined; this.recovering=true; void client.end().catch(()=>{}); this.schedule();
 }
 private schedule() {
  if (this.stopped || this.retry || !this.subscriberCount) return;
  if (this.attempts>=6) { this.all('unavailable'); this.subscribers.clear(); return; }
  const delay=Math.min(30000,(this.options.retryBaseMs ?? 1000)*2**this.attempts++);
  this.retry=setTimeout(()=> { this.retry=undefined; void this.connect().catch(()=>this.schedule()); },delay);
  this.retry.unref?.();
 }
 async close() {
  this.stopped=true;
  if (this.retry) clearTimeout(this.retry);
  this.retry=undefined; this.all('unavailable'); this.subscribers.clear();
  const client=this.client; this.client=undefined;
  await client?.end().catch(()=>{}); await this.connecting?.catch(()=>{});
 }
}
