import 'server-only';
import { z } from 'zod';
import type { Database } from '@/lib/db/types';
import type { RequestLimiter, RateAction } from '@/lib/security/rate-limit';
import { apiError, HttpError, json, readJson, tokenFrom, enforceRateLimit } from '@/features/backend/http';
import { validate } from '@/features/backend/validation';
import { assertBetaOperationAllowed, getBetaControls, type BetaControls, type BetaOperation } from '@/lib/config/beta-policy';
import { SocialError } from '@/features/social/errors';
import { publicKeySchema } from '@/features/social/seeking-schema';
import { interpretInputSchema } from './schema';
import { interpretConversation } from './parser';
import { IntentProductService } from './service';
import { RoomService } from './rooms';
export function createIntentProductHandler(options:{origin:string;db:()=>Database;limiter?:RequestLimiter;analyticsEnabled?:boolean;interpret?:(input:unknown)=>Promise<unknown>;getBetaControls?:()=>BetaControls}){
 const origin=new URL(options.origin).origin;
 return async(request:Request,path:string[]):Promise<Response>=>{
  try{
   const method=request.method,mutation=method!=='GET';
   if(mutation&&request.headers.get('origin')!==origin)throw new HttpError(403,'ORIGIN_REJECTED','Отправьте запрос с адреса приложения.');
   const [resource,key,operation]=path;
   let beta:BetaOperation=mutation?'mutation':'read',budget:RateAction=mutation?'socialWrite':'socialRead';
   if(resource==='interpret'){beta='read';budget='ai';}
   if(resource==='searches'&&path.length===1&&method==='POST'){beta='seeking';budget='seekingCreate';}
   if(resource==='offers'&&mutation)budget='connection';
   if(resource==='rooms'&&operation==='messages'&&mutation)budget='message';
   if(resource==='rooms'&&(operation==='block'||operation==='report')){beta='safety';budget=operation==='report'?'report':'socialWrite';}
   assertBetaOperationAllowed(beta,options.getBetaControls?.()??getBetaControls());
   await enforceRateLimit(options.limiter,budget,request);
   if(path.length>3)throw new SocialError('NOT_FOUND');
   const token=()=>tokenFrom(request),body=()=>readJson(request);
   if(resource==='interpret'&&path.length===1&&method==='POST')return json({interpretation:await (options.interpret??interpretConversation)(validate(interpretInputSchema,await body()))});
   // Database construction follows origin/beta/rate limits and validated routing.
   const intents=()=>new IntentProductService(options.db(),{analyticsEnabled:options.analyticsEnabled??false});
   const rooms=()=>new RoomService(options.db(),{analyticsEnabled:options.analyticsEnabled??false});
   if(resource==='searches'){
    if(path.length===1&&method==='GET')return json({searches:await intents().list(token())});
    if(path.length===1&&method==='POST')return json({search:await intents().create(token(),await body())},201);
    if(key)validate(publicKeySchema,key);
    if(path.length===2&&key&&method==='GET')return json({search:await intents().get(token(),key)});
    if(path.length===2&&key&&method==='PATCH')return json({search:await intents().update(token(),key,await body())});
    if(path.length===3&&key&&operation==='command'&&method==='POST')return json({search:await intents().command(token(),key,await body())});
   }
   if(resource==='offers'){
    if(path.length===1&&method==='GET')return json({offers:await intents().offers(token())});
    if(key)validate(publicKeySchema,key);
    if(path.length===2&&key&&method==='GET')return json({offer:await intents().offer(token(),key)});
    if(path.length===3&&key&&operation==='respond'&&method==='POST')return json({offer:await intents().respond(token(),key,await body())});
   }
   if(resource==='preferences'&&path.length===1){
    if(method==='GET')return json({preferences:await intents().preferences(token())});
    if(method==='PATCH')return json({preferences:await intents().savePreferences(token(),await body())});
   }
   if(resource==='rooms'){
    if(path.length===1&&method==='GET')return json({rooms:await rooms().list(token())});
    if(key)validate(publicKeySchema,key);
    if(path.length===2&&key&&method==='GET')return json({room:await rooms().get(token(),key)});
    if(path.length===3&&key&&operation==='messages'){
     if(method==='GET'){
      const query=validate(z.object({before:publicKeySchema.optional(),limit:z.coerce.number().int().min(1).max(50).optional()}).strict(),Object.fromEntries(new URL(request.url).searchParams));
      return json(await rooms().messages(token(),key,{...(query.before?{before:query.before}:{}),...(query.limit?{limit:query.limit}:{})}));
     }
     if(method==='POST')return json({message:await rooms().send(token(),key,await body())},201);
    }
    if(path.length===3&&key&&method==='POST'){
     if(operation==='state')return json({room:await rooms().transition(token(),key,await body())});
     if(operation==='block')return json(await rooms().block(token(),key,await body()));
     if(operation==='report')return json(await rooms().report(token(),key,await body()));
     if(operation==='remove')return json({room:await rooms().remove(token(),key,await body())});
     if(operation==='plan'){validate(z.object({}).strict(),await body());return json(await rooms().plan(token(),key));}
    }
   }
   throw new SocialError('NOT_FOUND');
  }catch(error){
   if(error instanceof z.ZodError)return json({error:{code:'INVALID_INPUT',message:'Проверьте условия намерения.'}},400);
   if(error instanceof SocialError)return json({error:{code:error.code,message:error.message}},error.status);
   return apiError(error);
  }
 };
}
