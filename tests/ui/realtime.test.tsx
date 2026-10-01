// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SocialLiveProvider, useSocialRefresh } from '@/features/realtime/client';
class Source {
 static all:Source[]=[]; listeners=new Map<string,(e:MessageEvent)=>void>(); closed=false;
 onopen:(()=>void)|null=null; onerror:(()=>void)|null=null;
 constructor(public url:string) { Source.all.push(this); }
 addEventListener(type:string,fn:(e:MessageEvent)=>void) { this.listeners.set(type,fn); }
 close() {this.closed=true;}
 emit(type:string,data:unknown={}) { this.listeners.get(type)?.(new MessageEvent(type,{data:JSON.stringify(data),lastEventId:'a'.repeat(24)})); }
}
function Consumer({reload,enabled=true}:{reload:()=>Promise<void>;enabled?:boolean}) { const live=useSocialRefresh(['connections'],reload,{enabled}); return <button onClick={live.reconnect}>{live.status}</button>; }
beforeEach(()=> {vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({profile:{alias:'A'}})})));});
afterEach(()=> {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); Source.all=[];});
it('shares one stream, coalesces invalidation and reruns after in-flight reload',async()=> {
 vi.useFakeTimers(); vi.stubGlobal('EventSource',Source); let release!:()=>void; let calls=0;
 const reload=()=> {calls++; return calls===1?new Promise<void>(r=>release=r):Promise.resolve();};
 const view=render(<SocialLiveProvider><Consumer reload={reload}/><Consumer reload={async()=>{}}/></SocialLiveProvider>);
 await act(async()=>{}); expect(Source.all).toHaveLength(1);
 await act(async()=> { Source.all[0]!.emit('invalidate',{topic:'connections'}); Source.all[0]!.emit('invalidate',{topic:'connections'}); await vi.advanceTimersByTimeAsync(50); });
 expect(calls).toBe(1);
 await act(async()=> {Source.all[0]!.emit('invalidate',{topic:'connections'}); await vi.advanceTimersByTimeAsync(50); release();});
 await act(async()=> {await vi.advanceTimersByTimeAsync(50);}); expect(calls).toBe(2);
 view.unmount(); expect(Source.all[0]!.closed).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('stops after six retries, exposes offline/manual retry and cancels timers',async()=> {
 vi.useFakeTimers(); vi.stubGlobal('EventSource',Source);
 const view=render(<SocialLiveProvider><Consumer reload={async()=>{}}/></SocialLiveProvider>);
 await act(async()=>{});
 for(let i=0;i<7;i++) await act(async()=> {Source.all.at(-1)!.onerror?.(); await vi.advanceTimersByTimeAsync(30000);});
 expect(Source.all).toHaveLength(7); expect(screen.getByRole('button')).toHaveTextContent('offline'); expect(vi.getTimerCount()).toBe(0);
 await act(async()=> {screen.getByRole('button').click();}); expect(Source.all).toHaveLength(8);
 view.unmount(); expect(vi.getTimerCount()).toBe(0);
});
it('does not open a connection for disabled consumers',async()=> {
 vi.stubGlobal('EventSource',Source); render(<SocialLiveProvider><Consumer reload={async()=>{}} enabled={false}/></SocialLiveProvider>); await act(async()=>{}); expect(Source.all).toHaveLength(0);
});
it('retains sync and invalidation while disabled and disconnects the final consumer',async()=> {
 vi.useFakeTimers();vi.stubGlobal('EventSource',Source);const reload=vi.fn(async()=>{});
 const view=render(<SocialLiveProvider><Consumer reload={reload}/></SocialLiveProvider>);await act(async()=>{});
 view.rerender(<SocialLiveProvider><Consumer reload={reload} enabled={false}/></SocialLiveProvider>);
 await act(async()=> {Source.all[0]!.emit('sync');Source.all[0]!.emit('invalidate',{topic:'connections'});await vi.advanceTimersByTimeAsync(100);});
 expect(reload).not.toHaveBeenCalled();expect(Source.all[0]!.closed).toBe(false);
 view.rerender(<SocialLiveProvider><Consumer reload={reload}/></SocialLiveProvider>);
 await act(async()=> {await vi.advanceTimersByTimeAsync(50);});expect(reload).toHaveBeenCalledTimes(1);
 view.rerender(<SocialLiveProvider>{null}</SocialLiveProvider>);expect(Source.all[0]!.closed).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('manual retry can recover the initial profile lookup failure',async()=> {
 vi.stubGlobal('EventSource',Source);const fetch=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ok:true,json:async()=>({profile:{alias:'A'}})});vi.stubGlobal('fetch',fetch);
 render(<SocialLiveProvider><Consumer reload={async()=>{}}/></SocialLiveProvider>);await act(async()=>{});
 expect(screen.getByRole('button')).toHaveTextContent('offline');expect(Source.all).toHaveLength(0);
 await act(async()=> {screen.getByRole('button').click();});expect(fetch).toHaveBeenCalledTimes(2);expect(Source.all).toHaveLength(1);
});
it('does not replay a pending callback after unmount and replaces the stream after profile activation',async()=> {
 vi.useFakeTimers();vi.stubGlobal('EventSource',Source);const reload=vi.fn(async()=>{});
 const view=render(<SocialLiveProvider><Consumer reload={reload}/></SocialLiveProvider>);await act(async()=>{});
 await act(async()=> {Source.all[0]!.emit('invalidate',{topic:'connections'});window.dispatchEvent(new Event('veya:social-profile-changed'));});
 expect(Source.all[0]!.closed).toBe(true);expect(Source.all).toHaveLength(2);expect(Source.all[1]!.url).toBe('/api/social/events');
 view.unmount();await act(async()=> {await vi.advanceTimersByTimeAsync(100);});expect(reload).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('closes live streaming when the browser goes offline and resynchronizes on online',async()=>{
 vi.stubGlobal('EventSource',Source);const reload=vi.fn(async()=>{});
 const view=render(<SocialLiveProvider><Consumer reload={reload}/></SocialLiveProvider>);await act(async()=>{});
 await act(async()=>{Source.all[0]!.onopen?.();window.dispatchEvent(new Event('offline'));});
 expect(Source.all[0]!.closed).toBe(true);expect(screen.getByRole('button')).toHaveTextContent('offline');
 await act(async()=>{window.dispatchEvent(new Event('online'));});expect(Source.all).toHaveLength(2);
 view.unmount();expect(Source.all[1]!.closed).toBe(true);
});
