'use client';
import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { requestApi } from '@/features/entry/client';
import { socialError } from '@/features/social/client';
import { useSocialRefresh } from '@/features/realtime/client';
import type { NotificationDTO } from './schema';
const api=<T,>(path:string,method='GET',body?:unknown)=>requestApi<T>(`/api/notifications${path}`,method,body);
const labels:Record<NotificationDTO['type'],string>={INTEREST_RECEIVED:'Получен новый отклик',INTEREST_ACCEPTED:'Отклик принят',NEW_MESSAGE:'Новое сообщение',PLAN_READY:'Ваш план готов',MEETUP_REMINDER:'Ваша встреча скоро начнётся',CANDIDATE_FOUND:'Найдена подходящая активность',OFFER_RECEIVED:'Новое предложение',LOBBY_READY:'Команда собрана',ROOM_MESSAGE:'Новое сообщение в комнате'};
/** Serialize initial/manual/live fetches and invalidate responses across profile recovery. */
function useNotificationRefresh(work:(current:()=>boolean)=>Promise<void>,clear:()=>void,enabled=true){
  const callbacks=useRef({work,clear});
  const state=useRef({mounted:false,enabled,epoch:0,pending:false,running:undefined as Promise<void>|undefined});
  useLayoutEffect(()=>{callbacks.current={work,clear};if(state.current.enabled!==enabled){state.current.epoch++;state.current.enabled=enabled;}},[work,clear,enabled]);
  const refresh=useCallback(async function refresh(){
    const current=state.current;if(!current.mounted||!current.enabled)return;
    current.pending=true;if(current.running){await current.running;return;}
    const run=async()=>{while(current.mounted&&current.enabled&&current.pending){current.pending=false;const epoch=current.epoch;await callbacks.current.work(()=>current.mounted&&current.epoch===epoch);}};
    current.running=run();try{await current.running;}finally{current.running=undefined;if(current.mounted&&current.enabled&&current.pending)void refresh();}
  },[]);
  useEffect(()=>{const current=state.current;current.mounted=true;const changed=()=>{current.epoch++;callbacks.current.clear();void refresh();};window.addEventListener('veya:social-profile-changed',changed);return()=>{current.mounted=false;current.epoch++;current.pending=false;window.removeEventListener('veya:social-profile-changed',changed);};},[refresh]);
  return refresh;
}
export function NotificationBadge({enabled=true}:{enabled?:boolean}){
  const [count,setCount]=useState(0),[capped,setCapped]=useState(false);
  const refresh=useNotificationRefresh(async current=>{try{const data=await api<{unreadCount:number;capped:boolean}>('/unread');if(current()){setCount(data.unreadCount);setCapped(data.capped);}}catch{if(current())setCount(0);}},()=>setCount(0),enabled);
  useEffect(()=>{if(enabled)void Promise.resolve().then(refresh);},[enabled,refresh]);
  useSocialRefresh(['notifications'],refresh,{enabled});
  return enabled&&count>0?<span aria-label={`Непрочитанных уведомлений: ${count}${capped?'+':''}`}> ({count}{capped?'+':''})</span>:null;
}
function supported(){return typeof window!=='undefined'&&typeof window.Notification!=='undefined'&&!!navigator.serviceWorker&&typeof window.PushManager==='function';}
function vapidBytes(value:string){const decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(decoded,c=>c.charCodeAt(0));}
export function PushControls(){
  const [ready,setReady]=useState(false),[enabled,setEnabled]=useState(false),[key,setKey]=useState<string|null>(null),[active,setActive]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
  const subscription=useRef<PushSubscription|null>(null);
  useEffect(()=>{let alive=true;void(async()=>{await Promise.resolve();if(!supported()){if(alive)setReady(true);return;}try{const capability=await api<{enabled:boolean;publicKey:string|null}>('/push');const registration=await navigator.serviceWorker.getRegistration('/');const current=await registration?.pushManager.getSubscription();if(alive){subscription.current=current??null;setActive(Boolean(current));setEnabled(capability.enabled);setKey(capability.publicKey);}}catch(e){if(alive)setMessage(socialError(e));}finally{if(alive)setReady(true);}})();return()=>{alive=false;};},[]);
  const enable=async()=>{if(busy||!key||!supported())return;setBusy(true);setMessage(null);let created:PushSubscription|null=null;
    try{const permission=await Notification.requestPermission();if(permission!=='granted'){setMessage('Браузер не разрешил уведомления. Вы можете просматривать уведомления на сайте.');return;}
      const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;
      created=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(key)});
      await api('/push','POST',{endpoint:created.endpoint,keys:created.toJSON().keys});subscription.current=created;setActive(true);setMessage('Уведомления браузера включены. Они содержат только общий текст об обновлении.');
    }catch(e){if(created)await created.unsubscribe().catch(()=>false);setMessage(socialError(e));}finally{setBusy(false);}};
  const disable=async()=>{if(busy||!subscription.current)return;setBusy(true);setMessage(null);try{const current=subscription.current;await api('/push','DELETE',{endpoint:current.endpoint});await current.unsubscribe();subscription.current=null;setActive(false);setMessage('Уведомления браузера отключены.');}catch(e){setMessage(socialError(e));}finally{setBusy(false);}};
  return <section aria-label="Уведомления браузера" style={{minWidth:0,overflowWrap:'anywhere'}}><h2>Уведомления браузера</h2><p>Уведомления браузера включаются по желанию. Они содержат общий текст и открывают список уведомлений.</p>{!ready?<p>Проверяем поддержку браузера…</p>:!supported()?<p>Уведомления браузера здесь недоступны. Вы можете просматривать уведомления на сайте.</p>:active?<button type="button" disabled={busy} onClick={()=>void disable()}>Отключить уведомления браузера</button>:Notification.permission==='denied'?<p>Уведомления запрещены в настройках браузера. Вы можете просматривать уведомления на сайте.</p>:!enabled?<p>Уведомления браузера не настроены. Вы можете просматривать уведомления на сайте.</p>:<button type="button" disabled={busy} onClick={()=>void enable()}>Включить уведомления браузера</button>}{message&&<p role="status">{message}</p>}</section>;
}
export function NotificationsScreen(){
  const [items,setItems]=useState<NotificationDTO[]>([]),[next,setNext]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true);
  const pageEpoch=useRef({value:0});
  useEffect(()=>{const state=pageEpoch.current;const changed=()=>{state.value++;};window.addEventListener('veya:social-profile-changed',changed);return()=>{state.value++;window.removeEventListener('veya:social-profile-changed',changed);};},[]);
  const refresh=useNotificationRefresh(async current=>{try{const data=await api<{notifications:NotificationDTO[];nextBefore:string|null}>('');if(current()){setItems(data.notifications);setNext(data.nextBefore);setError(null);}}catch(e){if(current())setError(socialError(e));}finally{if(current())setLoading(false);}},()=>{setItems([]);setNext(null);setError(null);setLoading(true);});
  useEffect(()=>{void Promise.resolve().then(refresh);},[refresh]);useSocialRefresh(['notifications'],refresh);
  const more=async()=>{if(!next)return;const epoch=pageEpoch.current.value;try{const data=await api<{notifications:NotificationDTO[];nextBefore:string|null}>(`?before=${encodeURIComponent(next)}`);if(pageEpoch.current.value!==epoch)return;setItems(old=>[...old,...data.notifications.filter(n=>!old.some(o=>o.publicKey===n.publicKey))]);setNext(data.nextBefore);}catch(e){setError(socialError(e));}};
  const read=async(key:string)=>{try{await api(`/${key}/read`,'POST',{});await refresh();}catch(e){setError(socialError(e));}};
  return <section className="social-shell" style={{minWidth:0,overflowWrap:'anywhere'}}><h1>Уведомления</h1><p>Личные уведомления для вашего текущего профиля. Обновите список в любое время, чтобы проверить новые уведомления.</p><button type="button" onClick={()=>void refresh()}>Обновить уведомления</button>{error&&<p role="alert">{error}</p>}{loading?<p>Загружаем уведомления…</p>:items.length===0?<p>Уведомлений пока нет.</p>:<ul style={{paddingInlineStart:'1.25rem'}}>{items.map(item=><li key={item.publicKey} style={{marginBlock:'1rem'}}><Link href={item.href}>{labels[item.type]}</Link><p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ru-RU')}</time></p>{item.readAt?<span>Прочитано</span>:<button type="button" onClick={()=>void read(item.publicKey)}>Отметить как прочитанное</button>}</li>)}</ul>}{next&&<button type="button" onClick={()=>void more()}>Более ранние уведомления</button>}<PushControls/></section>;
}
