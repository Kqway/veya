import { afterEach,describe,expect,it,vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createECDH,randomBytes } from 'node:crypto';
import webPush from 'web-push';
const requestMock=vi.hoisted(()=>vi.fn());
vi.mock('node:https',()=>({default:{request:requestMock}}));
import { sendBrowserPush,PushDeliveryError,genericPushPayload } from '@/features/notifications/push';
const vapid=webPush.generateVAPIDKeys(),config={...vapid,subject:'mailto:push@example.test'};
const ecdh=createECDH('prime256v1');ecdh.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/browser/token',keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
afterEach(()=>{vi.useRealTimers();requestMock.mockReset();});
describe('bounded encrypted browser push transport',()=>{
 it('never follows redirects and encrypts private-free generic payload',async()=>{
  requestMock.mockImplementation((_endpoint:unknown,options:{headers:Record<string,string>},response:(value:{statusCode:number;resume:()=>void})=>void)=>{
   expect(options.headers.Authorization??options.headers.authorization).toMatch(/^vapid /);const req=new EventEmitter() as EventEmitter&{end:(body:Buffer)=>void;destroy:()=>void};
   req.end=body=>{expect(body.toString()).not.toContain('You have a new update');response({statusCode:302,resume:()=>{}});req.emit('close');};req.destroy=()=>{};return req;
  });
  await expect(sendBrowserPush(subscription,genericPushPayload,config)).rejects.toBeInstanceOf(PushDeliveryError);expect(requestMock).toHaveBeenCalledTimes(1);expect(requestMock.mock.calls[0]![0]).toBe(subscription.endpoint);
 });
 it('rejects an untrusted destination before constructing any outbound request',async()=>{await expect(sendBrowserPush({...subscription,endpoint:'https://127.0.0.1/secrets'},genericPushPayload,config)).rejects.toThrow();expect(requestMock).not.toHaveBeenCalled();});
 it('destroys stalled requests within five seconds',async()=>{
  vi.useFakeTimers();const destroy=vi.fn();requestMock.mockImplementation(()=>{const req=new EventEmitter() as EventEmitter&{end:()=>void;destroy:(error:Error)=>void};req.end=()=>{};req.destroy=error=>{destroy();req.emit('error',error);req.emit('close');};return req;});
  const pending=sendBrowserPush(subscription,genericPushPayload,config);const rejected=expect(pending).rejects.toBeInstanceOf(PushDeliveryError);await vi.advanceTimersByTimeAsync(5000);await rejected;expect(destroy).toHaveBeenCalledTimes(1);
 });
});
