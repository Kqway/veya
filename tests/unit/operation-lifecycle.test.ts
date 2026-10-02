import {afterEach,expect,it,vi} from 'vitest';

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

it('finishes the current work on SIGTERM, closes once, removes handlers and returns the signal exit code',async()=>{
 const {runOperation}=await import('@/lib/logging/operation');
 vi.spyOn(console,'info').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
 const initial=process.listenerCount('SIGTERM');let finish!:()=>void;
 const close=vi.fn(async()=>{});
 const operation=runOperation('worker',async signal=>{
  process.emit('SIGTERM');expect(signal.aborted).toBe(true);
  await new Promise<void>(resolve=>{finish=resolve;});
 },close);
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 finish();expect(await operation).toBe(143);expect(close).toHaveBeenCalledTimes(1);
 expect(process.listenerCount('SIGTERM')).toBe(initial);
});

it('closes resources after a failure and emits fixed safe failure logs',async()=>{
 const {runOperation}=await import('@/lib/logging/operation');
 vi.spyOn(console,'info').mockImplementation(()=>{});const output=vi.spyOn(console,'error').mockImplementation(()=>{});
 let closed=false;
 expect(await runOperation('migration',async()=>{throw new Error('postgres://private:password private body');},async()=>{closed=true;})).toBe(1);
 expect(closed).toBe(true);expect(output.mock.calls.map(call=>call[0]).join(' ')).toContain('migration_failed');
 expect(output.mock.calls.map(call=>call[0]).join(' ')).not.toMatch(/password|private|postgres:/);
});

it('bounds stalled cleanup and returns failure rather than reporting success',async()=>{
 vi.useFakeTimers();const {runOperation}=await import('@/lib/logging/operation');
 vi.spyOn(console,'info').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});
 const exiting=vi.spyOn(process,'exit').mockImplementation(()=>undefined as never);
 const operation=runOperation('retention',async()=>{},()=>new Promise<void>(()=>{}),{cleanupMs:50});
 await vi.advanceTimersByTimeAsync(50);
 expect(await operation).toBe(1);expect(exiting).toHaveBeenCalledWith(1);
});
