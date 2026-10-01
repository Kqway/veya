'use client';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { socialTopics, type SocialInvalidation, type SocialTopic } from './types';
export type SocialLiveStatus = 'inactive' | 'connecting' | 'live' | 'reconnecting' | 'offline';
export type SocialLiveState = {status:SocialLiveStatus;profileActive:boolean;reconnect:()=>void};
type Subscription = {enabled:boolean;receive:(event:SocialInvalidation|null)=>void};
type ContextValue = SocialLiveState & {subscribe:(subscription:Subscription)=>()=>void;changed:()=>void};
const inactive:SocialLiveState={status:'inactive',profileActive:false,reconnect:()=>{}};
const Context=createContext<ContextValue>({...inactive,subscribe:()=>()=>{},changed:()=>{}});
export function SocialLiveProvider({children}:{children:ReactNode}) {
 const [status,setStatus]=useState<SocialLiveStatus>('inactive');
 const [profileActive,setProfileActive]=useState(false);
 const state=useRef({mounted:false,active:false,online:true,started:false,attempts:0,cursor:undefined as string|undefined,source:undefined as EventSource|undefined,timer:undefined as ReturnType<typeof setTimeout>|undefined,profileAbort:undefined as AbortController|undefined,subscriptions:new Set<Subscription>()});
 const stop=useCallback(()=> {
  const current=state.current;
  current.source?.close(); current.source=undefined;
  if(current.timer) clearTimeout(current.timer); current.timer=undefined;
 },[]);
 const broadcast=useCallback((event:SocialInvalidation|null)=> {for(const sub of state.current.subscriptions) sub.receive(event);},[]);
 const openRef=useRef<()=>void>(()=>{});
 const loadProfileRef=useRef<()=>void>(()=>{});
 const open=useCallback(()=> {
  const current=state.current;
  if(!current.mounted || !current.online || !current.active || !current.subscriptions.size || (!current.started && ![...current.subscriptions].some(s=>s.enabled)) || current.source || current.timer) return;
  if(typeof EventSource==='undefined') {setStatus('offline'); return;}
  current.started=true;
  setStatus(current.attempts ? 'reconnecting':'connecting');
  const source=new EventSource(`/api/social/events${current.cursor ? `?cursor=${encodeURIComponent(current.cursor)}`:''}`);
  current.source=source;
  source.onopen=()=> {if(current.source===source && current.mounted) setStatus('live');};
  const acceptCursor=(event:MessageEvent)=> {if(/^[A-Za-z0-9_-]{24}$/.test(event.lastEventId)) current.cursor=event.lastEventId;};
  source.addEventListener('sync',(event)=> {
   if(current.source!==source || !current.mounted) return;
   current.attempts=0; acceptCursor(event as MessageEvent); broadcast(null);
  });
  source.addEventListener('invalidate',(event)=> {
   if(current.source!==source || !current.mounted) return;
   try {
    const data:unknown=JSON.parse((event as MessageEvent).data);
    if(!data || typeof data!=='object') return;
    const value=data as Record<string,unknown>;
    if(!socialTopics.includes(value.topic as SocialTopic) || Object.keys(value).some(key=>!['topic','matchKey'].includes(key)) || (value.matchKey!==undefined && (typeof value.matchKey!=='string' || !/^[A-Za-z0-9_-]{24}$/.test(value.matchKey)))) return;
    acceptCursor(event as MessageEvent); broadcast(value as SocialInvalidation);
   } catch { /* Ignore malformed frames; persisted APIs still restore on sync. */ }
  });
  source.onerror=()=> {
   if(current.source!==source || !current.mounted) return;
   source.close(); current.source=undefined;
   if(current.attempts>=6) {setStatus('offline'); return;}
   const delay=Math.min(30000,1000*2**current.attempts++);
   setStatus('reconnecting');
   current.timer=setTimeout(()=> {current.timer=undefined; openRef.current();},delay);
  };
 },[broadcast]);
 useEffect(()=> {openRef.current=open;},[open]);
 const reconnect=useCallback(()=> {
  const current=state.current; stop(); current.attempts=0; if(!current.active) loadProfileRef.current(); else openRef.current();
 },[stop]);
 const subscribe=useCallback((subscription:Subscription)=> {
  const current=state.current; current.subscriptions.add(subscription); openRef.current();
  return ()=> {current.subscriptions.delete(subscription); if(!current.subscriptions.size) {stop(); current.started=false; current.attempts=0; if(current.mounted) setStatus('inactive');}};
 },[stop]);
 const changed=useCallback(()=> {openRef.current();},[]);
 useEffect(()=> {
  const current=state.current; current.mounted=true;
  const loadProfile=()=> {
   current.profileAbort?.abort(); stop(); current.started=false; current.active=false; current.cursor=undefined; current.attempts=0;
   setProfileActive(false); setStatus('inactive');
   const abort=new AbortController(); current.profileAbort=abort;
   void fetch('/api/social/profile',{credentials:'same-origin',cache:'no-store',signal:abort.signal}).then(async response=> {
    if(!response.ok) return false;
    const result:unknown=await response.json();
    return !!result && typeof result==='object' && !!(result as {profile?:unknown}).profile;
   }).then(active=> {
    if(abort.signal.aborted || !current.mounted) return;
    current.active=active; setProfileActive(active); if(active) openRef.current();
   }).catch(()=> {if(!abort.signal.aborted && current.mounted) setStatus('offline');});
  };
  loadProfileRef.current=loadProfile;
  const offline=()=>{current.online=false;stop();setStatus('offline');};
  const online=()=>{current.online=true;current.attempts=0;if(current.active)openRef.current();else loadProfile();};
  loadProfile();window.addEventListener('offline',offline);window.addEventListener('online',online);window.addEventListener('veya:social-profile-changed',loadProfile);
  return ()=> {current.mounted=false; current.profileAbort?.abort(); stop(); window.removeEventListener('veya:social-profile-changed',loadProfile);window.removeEventListener('offline',offline);window.removeEventListener('online',online);};
 },[stop]);
 const value=useMemo(()=>({status,profileActive,reconnect,subscribe,changed}),[status,profileActive,reconnect,subscribe,changed]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSocialLive():SocialLiveState {
 const {status,profileActive,reconnect}=useContext(Context);
 return {status,profileActive,reconnect};
}
export function useSocialRefresh(topics:SocialTopic|readonly SocialTopic[], reload:()=>Promise<void>, options:{enabled?:boolean}={}):SocialLiveState {
 const context=useContext(Context);
 const {subscribe,changed}=context;
 const current=useRef({topics:new Set<SocialTopic>(typeof topics==='string' ? [topics]:topics),reload,enabled:options.enabled!==false,mounted:false,pending:false,running:false,timer:undefined as ReturnType<typeof setTimeout>|undefined});
 const schedule=useCallback(function scheduleRefresh() {
  const state=current.current;
  if(!state.mounted || !state.enabled || !state.pending || state.running || state.timer) return;
  state.timer=setTimeout(()=> {
   state.timer=undefined;
   if(!state.mounted || !state.enabled || !state.pending || state.running) return;
   state.pending=false; state.running=true;
   void Promise.resolve().then(()=>state.reload()).catch(()=>{}).finally(()=> {state.running=false; if(state.mounted) scheduleRefresh();});
  },50);
 },[]);
 const subscription=useRef<Subscription>({enabled:options.enabled!==false,receive:()=>{}});
 useLayoutEffect(()=> {
  current.current.topics=new Set(typeof topics==='string' ? [topics]:topics);
  current.current.reload=reload; current.current.enabled=options.enabled!==false;
  subscription.current.enabled=options.enabled!==false;
  subscription.current.receive=event=> {
   if(event && !current.current.topics.has(event.topic)) return;
   current.current.pending=true; schedule();
  };
 },[topics,reload,options.enabled,schedule]);
 useEffect(()=> {
  const state=current.current; state.mounted=true;
  const off=subscribe(subscription.current);
  return ()=> {state.mounted=false; state.pending=false; if(state.timer) clearTimeout(state.timer); state.timer=undefined; off();};
 },[subscribe]);
 useEffect(()=> {changed(); schedule();},[options.enabled,changed,schedule]);
 return {status:context.status,profileActive:context.profileActive,reconnect:context.reconnect};
}
