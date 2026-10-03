// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from 'vitest';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { NotificationBadge,NotificationsScreen,PushControls } from '@/features/notifications/components';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const response=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
describe('private inbox and explicit browser push opt-in',()=>{
 it('keeps unsupported browsers usable and never requests permission on initial visit',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>response({notifications:[],nextBefore:null})));render(<NotificationsScreen/>);expect(await screen.findByText('Уведомлений пока нет.')).toBeInTheDocument();expect(screen.getByText('Уведомления браузера здесь недоступны. Вы можете просматривать уведомления на сайте.')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Обновить уведомления'}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
 });
 it('requests browser permission only after Enable and handles denial gracefully',async()=>{
  const requestPermission=vi.fn(async()=>'denied');vi.stubGlobal('Notification',{permission:'default',requestPermission});vi.stubGlobal('PushManager',function(){});
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:vi.fn(async()=>undefined)}});
  vi.stubGlobal('fetch',vi.fn(async()=>response({enabled:true,publicKey:'a'.repeat(87)})));render(<PushControls/>);const enable=await screen.findByRole('button',{name:'Включить уведомления браузера'});expect(requestPermission).not.toHaveBeenCalled();fireEvent.click(enable);expect(await screen.findByText('Браузер не разрешил уведомления. Вы можете просматривать уведомления на сайте.')).toBeInTheDocument();expect(requestPermission).toHaveBeenCalledTimes(1);
  Reflect.deleteProperty(navigator,'serviceWorker');
 });
 it('disables server subscription before browser unsubscribe and shows fixed generic copy',async()=>{
  vi.stubGlobal('Notification',{permission:'granted',requestPermission:vi.fn()});vi.stubGlobal('PushManager',function(){});const unsubscribe=vi.fn(async()=>true);const sub={endpoint:'https://fcm.googleapis.com/browser',unsubscribe};Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:vi.fn(async()=>({pushManager:{getSubscription:vi.fn(async()=>sub)}}))}});
  const fetchMock=vi.fn(async(_path:string,options?:RequestInit)=>{if(options?.method==='DELETE'){expect(unsubscribe).not.toHaveBeenCalled();return response({subscribed:false});}return response({enabled:true,publicKey:'a'.repeat(87)});});vi.stubGlobal('fetch',fetchMock);render(<PushControls/>);fireEvent.click(await screen.findByRole('button',{name:'Отключить уведомления браузера'}));expect(await screen.findByText('Уведомления браузера отключены.')).toBeInTheDocument();expect(unsubscribe).toHaveBeenCalledTimes(1);expect(fetchMock.mock.calls[1]![1]?.body).toBe(JSON.stringify({endpoint:sub.endpoint}));Reflect.deleteProperty(navigator,'serviceWorker');
 });
 it('renders private safe inbox text and marks one notification through owned API',async()=>{
  const key='a'.repeat(24),notification={publicKey:key,type:'NEW_MESSAGE',createdAt:'2026-10-03T10:20:00.000Z',readAt:null,href:'/notifications'};const fetchMock=vi.fn(async(_path:string,options?:RequestInit)=>response(options?.method==='POST'?{read:true}:{notifications:[notification],nextBefore:null}));vi.stubGlobal('fetch',fetchMock);render(<NotificationsScreen/>);expect(await screen.findByRole('link',{name:'Новое сообщение'})).toHaveAttribute('href','/notifications');expect(screen.getByText(new Date(notification.createdAt).toLocaleString('ru-RU'))).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Отметить как прочитанное'}));await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith(`/api/notifications/${key}/read`,expect.objectContaining({method:'POST',body:'{}'})));
 });
 it('serializes manual refresh behind an initial response and fetches the final state',async()=>{
  let release!:(response:Response)=>void;const first=new Promise<Response>(resolve=>release=resolve);const item={publicKey:'b'.repeat(24),type:'NEW_MESSAGE',createdAt:new Date().toISOString(),readAt:null,href:'/notifications'};
  const fetchMock=vi.fn().mockReturnValueOnce(first).mockResolvedValue(response({notifications:[item],nextBefore:null}));vi.stubGlobal('fetch',fetchMock);render(<NotificationsScreen/>);await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('button',{name:'Обновить уведомления'}));expect(fetchMock).toHaveBeenCalledTimes(1);await act(async()=>release(response({notifications:[],nextBefore:null})));expect(await screen.findByRole('link',{name:'Новое сообщение'})).toBeInTheDocument();expect(fetchMock).toHaveBeenCalledTimes(2);
 });
 it('invalidates old session inbox responses when profile recovery changes the binding',async()=>{
  let release!:(response:Response)=>void;const first=new Promise<Response>(resolve=>release=resolve);const item={publicKey:'c'.repeat(24),type:'NEW_MESSAGE',createdAt:new Date().toISOString(),readAt:null,href:'/m/'+'d'.repeat(24)};
  const fetchMock=vi.fn().mockReturnValueOnce(first).mockResolvedValue(response({notifications:[],nextBefore:null}));vi.stubGlobal('fetch',fetchMock);render(<NotificationsScreen/>);await waitFor(()=>expect(fetchMock).toHaveBeenCalledTimes(1));act(()=>window.dispatchEvent(new Event('veya:social-profile-changed')));await act(async()=>release(response({notifications:[item],nextBefore:null})));expect(await screen.findByText('Уведомлений пока нет.')).toBeInTheDocument();expect(screen.queryByRole('link',{name:'Новое сообщение'})).not.toBeInTheDocument();expect(fetchMock).toHaveBeenCalledTimes(2);
 });
 it('shows bounded accessible unread count and stays quiet when disabled',async()=>{
  const fetchMock=vi.fn(async()=>response({unreadCount:1000,capped:true}));vi.stubGlobal('fetch',fetchMock);const {rerender}=render(<NotificationBadge enabled={false}/>);expect(fetchMock).not.toHaveBeenCalled();rerender(<NotificationBadge/>);expect(await screen.findByLabelText('Непрочитанных уведомлений: 1000+')).toBeInTheDocument();
 });
});
it('treats an undefined browser PushManager as unsupported without requesting capability',async()=>{
 vi.stubGlobal('Notification',{permission:'default'});vi.stubGlobal('PushManager',undefined);
 Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:vi.fn()}});
 vi.stubGlobal('fetch',vi.fn(async()=>response({enabled:false,publicKey:null})));render(<PushControls/>);
 expect(await screen.findByText('Уведомления браузера здесь недоступны. Вы можете просматривать уведомления на сайте.')).toBeVisible();expect(fetch).not.toHaveBeenCalled();
 Reflect.deleteProperty(navigator,'serviceWorker');
});
it('shows Russian fallback for browser service-worker failures without exposing browser details',async()=>{
 vi.stubGlobal('Notification',{permission:'default'});vi.stubGlobal('PushManager',function(){});
 Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{getRegistration:vi.fn(async()=>{throw new TypeError('Failed to access service worker');})}});
 vi.stubGlobal('fetch',vi.fn(async()=>response({enabled:true,publicKey:'a'.repeat(87)})));
 try {
  render(<PushControls/>);
  expect(await screen.findByRole('status')).toHaveTextContent('Не удалось выполнить действие. Попробуйте снова.');
  expect(screen.getByRole('status')).not.toHaveTextContent('Failed to access');
 } finally { Reflect.deleteProperty(navigator,'serviceWorker'); }
});
