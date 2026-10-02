import 'server-only';
import { z } from 'zod';
import type { Database } from '@/lib/db/types';
import type { RequestLimiter } from '@/lib/security/rate-limit';
import { apiError, enforceRateLimit, HttpError, json, readJson, tokenFrom } from '@/features/backend/http';
import { validate } from '@/features/backend/validation';
import { SocialError } from '@/features/social/errors';
import { publicKeySchema } from '@/features/social/seeking-schema';
import { NotificationService } from './service';
import type { PushConfig } from './schema';
import { assertBetaOperationAllowed, getBetaControls, type BetaControls } from '@/lib/config/beta-policy';
export function createNotificationHandler(options:{origin:string;db:()=>Database;limiter?:RequestLimiter;push?:PushConfig;getBetaControls?:()=>BetaControls}){
  const origin=new URL(options.origin).origin;
  return async(request:Request,path:string[]=[])=>{
    try{
      if(request.method!=='GET'&&request.headers.get('origin')!==origin)throw new HttpError(403,'ORIGIN_REJECTED','Use the application origin.');
      if(request.method!=='GET')assertBetaOperationAllowed(request.method==='DELETE'&&path.length===1&&path[0]==='push'?'safety':'mutation',options.getBetaControls?.()??getBetaControls());
      await enforceRateLimit(options.limiter,path[0]==='push'&&request.method!=='GET'?'push':request.method==='GET'?'socialRead':'socialWrite',request);
      const token=tokenFrom(request),method=request.method;
      const service=()=>new NotificationService(options.db(),{origin:options.origin,...(options.push?{push:options.push}:{})});
      if(!path.length&&method==='GET'){
        const query=validate(z.object({before:publicKeySchema.optional(),limit:z.string().regex(/^\d{1,2}$/).optional()}).strict(),Object.fromEntries(new URL(request.url).searchParams));
        return json(await service().list(token,{...(query.before?{before:query.before}:{}),...(query.limit?{limit:Number(query.limit)}:{})}));
      }
      if(path.length===1&&path[0]==='unread'&&method==='GET')return json(await service().unread(token));
      if(path.length===2&&path[1]==='read'&&method==='POST'){validate(publicKeySchema,path[0]);validate(z.object({}).strict(),await readJson(request));return json(await service().read(token,path[0]!));}
      if(path.length===1&&path[0]==='push'){
        if(method==='GET')return json(await service().capability(token));
        if(method==='POST'){const input=await readJson(request);return json(await service().subscribe(token,input),201);}
        if(method==='DELETE'){const input=await readJson(request);return json(await service().unsubscribe(token,input));}
      }
      throw new SocialError('NOT_FOUND');
    }catch(error){if(error instanceof SocialError)return json({error:{code:error.code,message:error.message}},error.status);return apiError(error);}
  };
}
