import 'server-only';
import https from 'node:https';
import webPush from 'web-push';
import { pushEndpointSchema, type PushConfig, type PushSubscriptionInput } from './schema';
export const genericPushPayload=JSON.stringify({title:'Intavro',body:'У вас новое уведомление в Intavro',url:'/notifications'});
export class PushDeliveryError extends Error {constructor(readonly statusCode?:number){super('Push delivery failed.');}}
export type PushSender=(subscription:PushSubscriptionInput,payload:string,config:PushConfig)=>Promise<void>;
/** Build encrypted standards payload, then own transport: exact HTTPS providers, no redirects, 5s deadline. */
export const sendBrowserPush:PushSender=async(subscription,payload,config)=>{
  const endpoint=pushEndpointSchema.parse(subscription.endpoint);
  const details=webPush.generateRequestDetails({...subscription,endpoint},payload,{TTL:60,vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey}});
  await new Promise<void>((resolve,reject)=>{
    const req=https.request(endpoint,{method:details.method,headers:details.headers},response=>{
      response.resume();
      if(response.statusCode&&response.statusCode>=200&&response.statusCode<300)resolve();else reject(new PushDeliveryError(response.statusCode));
    });
    const timer=setTimeout(()=>req.destroy(new PushDeliveryError()),5000);
    req.on('error',()=>reject(new PushDeliveryError()));
    req.on('close',()=>clearTimeout(timer));
    req.end(details.body);
  });
};
