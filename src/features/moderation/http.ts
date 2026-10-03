import "server-only";
import { z } from "zod";
import type { Database } from "@/lib/db/types";
import type { RequestLimiter } from "@/lib/security/rate-limit";
import { apiError,HttpError,json,readJson } from "@/features/backend/http";
import { validate } from "@/features/backend/validation";
import { ModerationService,type ModerationOptions } from "./service";
export const MODERATOR_COOKIE='veya_moderator';
export function moderatorToken(request:Request):string {
 for(const part of (request.headers.get('cookie')??'').split(';')){
  const separator=part.indexOf('=');
  if(part.slice(0,separator).trim()===MODERATOR_COOKIE){try{return decodeURIComponent(part.slice(separator+1));}catch{return '';}}
 }
 return '';
}
export function createModerationHandler(options:ModerationOptions&{db:()=>Database;origin:string;secureCookie:boolean;limiter?:RequestLimiter}) {
 const origin=new URL(options.origin).origin;
 const cookie={httpOnly:true,sameSite:'strict' as const,secure:options.secureCookie,path:'/api/moderation'};
 return async(request:Request,path:string[])=>{
  try{
   if(request.method!=='GET'&&request.headers.get('origin')!==origin)throw new HttpError(403,'ORIGIN_REJECTED','Используйте адрес приложения.');
   const token=moderatorToken(request);
   const decision=await options.limiter?.check('moderation',token);
   if(decision&&!decision.allowed)throw new HttpError(429,'RATE_LIMITED','Немного подождите и попробуйте снова.',decision.retryAfterSeconds);
   const service=new ModerationService(options.db(),options);
   if(path.length===1&&path[0]==='session'){
    if(request.method==='POST'){
     const input=validate(z.object({secret:z.string().max(256)}).strict(),await readJson(request));
     const session=await service.login(input.secret),response=json({authenticated:true,expiresAt:session.expiresAt});
     response.cookies.set(MODERATOR_COOKIE,session.token,{...cookie,expires:new Date(session.expiresAt)});return response;
    }
    if(request.method==='GET')return json(await service.session(token));
    if(request.method==='DELETE'){
     const response=json(await service.logout(token));response.cookies.set(MODERATOR_COOKIE,'',{...cookie,maxAge:0,expires:new Date(0)});return response;
    }
   }
   if(path[0]==='reports'){
    if(path.length===1&&request.method==='GET'){
     const query=validate(z.object({status:z.enum(['open','reviewing','resolved','dismissed']).optional()}).strict(),Object.fromEntries(new URL(request.url).searchParams));
     return json(await service.queue(token,query.status));
    }
    if(path.length===2&&request.method==='GET')return json(await service.evidence(token,path[1]!));
    if(path.length===2&&request.method==='PATCH')return json(await service.action(token,path[1]!,await readJson(request)));
   }
   throw new HttpError(404,'NOT_FOUND','Ресурс модерации недоступен.');
  }catch(error){return apiError(error);}
 };
}
