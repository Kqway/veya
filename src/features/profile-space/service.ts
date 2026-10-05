import 'server-only';
import type { Database, DatabaseExecutor } from '@/lib/db/types';
import { rankCompatible } from '@/features/discovery/engine';
import { lockProfiles, reauthorize, requireProfile, type ProfileRow } from '@/features/social/context';
import { readHandle, postById } from '@/features/social/discovery';
import { requestByKey, type RequestRow } from '@/features/social/connections';
import { candidate, readPost, type PostRow } from '@/features/social/post-repository';
import { isBlocked, pairIdentity, peerId, readPair, type PairRow } from '@/features/social/pairs';
import { strongerMode, publicKeySchema } from '@/features/social/seeking-schema';
import { parseSocialInput } from '@/features/social/profile-schema';
import { fail } from '@/features/social/errors';
import { customizationSchema, defaultCustomization, type Customization, type ProfileSpace, type ActivitySummary, type CurrentIntent } from './schema';
import { projectProfileSpace } from './projection';
export async function readCustomization(tx:DatabaseExecutor,profile:string):Promise<Customization>{
 const row=(await tx.query<{customization:unknown}>('SELECT customization FROM social_profile_spaces WHERE profile_id=$1',[profile])).rows[0];
 return row?customizationSchema.parse(row.customization):defaultCustomization();
}
async function activeProfile(tx:DatabaseExecutor,id:string):Promise<ProfileRow>{
 const result=await tx.query<ProfileRow>("SELECT id,alias,privacy_mode,avatar_seed,age_band,languages,created_at,moderation_status FROM social_profiles WHERE id=$1 AND deleted_at IS NULL AND moderation_status='active'",[id]);
 return result.rows[0]??fail('NOT_FOUND');
}
function activePost(post:PostRow){if(post.status!=='active'||post.expires_at.getTime()<=Date.now())fail('NOT_FOUND');}
async function history(tx:DatabaseExecutor,profile:string,selected:string[]=[]):Promise<ActivitySummary[]>{
 // One grouped query with a bounded DTO; counts refer to created seeking posts.
 const rows=await tx.query<{activity_key:string;activity_label:string;count:string}>(`SELECT history.activity_key,(SELECT latest.activity_label FROM seeking_posts latest WHERE latest.profile_id=$1 AND latest.activity_key=history.activity_key ORDER BY latest.created_at DESC,latest.id LIMIT 1) AS activity_label,least(count(*),1000000)::text AS count
 FROM seeking_posts history WHERE profile_id=$1 GROUP BY history.activity_key ORDER BY (history.activity_key=ANY($2::text[])) DESC,max(created_at) DESC,history.activity_key LIMIT 20`,[profile,selected]);
 return rows.rows.map(r=>({activityKey:r.activity_key,activityLabel:r.activity_label,count:Number(r.count)}));
}
async function intentOptions(tx:DatabaseExecutor,profile:string){return (await tx.query<{public_key:string;activity_label:string}>(`SELECT public_key,activity_label FROM seeking_posts WHERE profile_id=$1 AND status='active' AND expires_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM seeking_availability WHERE post_id=seeking_posts.id AND end_at>clock_timestamp()) ORDER BY created_at DESC,id LIMIT 3`,[profile])).rows.map(r=>({publicKey:r.public_key,activityLabel:r.activity_label}));}
const intent=(post:PostRow,label=post.activity_label,timeHint:string|null=null):CurrentIntent=>({activityLabel:label,interactionMode:post.interaction_mode,format:post.format,timeHint});
function pairMode(pair:PairRow,profile:ProfileRow){return strongerMode(profile.privacy_mode,pair.low_profile_id===profile.id?pair.low_privacy:pair.high_privacy);}
async function pairPostMode(tx:DatabaseExecutor,pair:PairRow,profile:ProfileRow){
 const rows=await tx.query<{privacy_mode:ProfileRow['privacy_mode']}>(`SELECT CASE WHEN bool_or(s.privacy_mode='INCOGNITO') THEN 'INCOGNITO' WHEN bool_or(s.privacy_mode='PRIVATE') THEN 'PRIVATE' ELSE 'OPEN' END AS privacy_mode FROM seeking_posts s WHERE s.profile_id=$1 AND s.id IN (
 SELECT h.source_post_id FROM discovery_handles h WHERE h.pair_id=$2 UNION SELECT h.target_post_id FROM discovery_handles h WHERE h.pair_id=$2
 UNION SELECT r.source_post_id FROM connection_requests r WHERE r.pair_id=$2 UNION SELECT r.target_post_id FROM connection_requests r WHERE r.pair_id=$2)`,[profile.id,pair.id]);
 return rows.rows.reduce((mode,row)=>strongerMode(mode,row.privacy_mode),pairMode(pair,profile));
}
type MatchRow={public_key:string;pair_id:string;request_id:string;activity_label:string;status:string};
async function matchByKey(tx:DatabaseExecutor,key:string,actor:string){return (await tx.query<MatchRow>(`SELECT m.* FROM social_matches m JOIN social_pairs p ON p.id=m.pair_id WHERE m.public_key=$1 AND $2 IN(p.low_profile_id,p.high_profile_id)`,[key,actor])).rows[0]??fail('NOT_FOUND');}
async function requestAction(tx:DatabaseExecutor,request:RequestRow):Promise<ProfileSpace['action']>{
 if(request.status==='pending')return {kind:'connections',key:request.public_key};
 if(request.status!=='accepted')fail('NOT_FOUND');
 const match=(await tx.query<{public_key:string}>('SELECT public_key FROM social_matches WHERE request_id=$1 AND status=\'active\'',[request.id])).rows[0]??fail('NOT_FOUND');
 return {kind:'chat',key:match.public_key};
}
export class ProfileSpaceService {
 constructor(private readonly db:Database){}
 async get(token:string):Promise<ProfileSpace>{return this.self(token);}
 async update(token:string,input:unknown):Promise<ProfileSpace>{return this.self(token,parseSocialInput(customizationSchema,input));}
 private async self(token:string,settings?:Customization):Promise<ProfileSpace>{
  return this.db.transaction(async tx=>{
   let actor=await requireProfile(tx,token);await lockProfiles(tx,[actor.id]);actor=await reauthorize(tx,token,actor.id);
   const stored=settings??await readCustomization(tx,actor.id);
   const options=await intentOptions(tx,actor.id),activities=await history(tx,actor.id,stored.selectedActivities);
   if(settings){
    if(settings.intentPostKey&&!options.some(p=>p.publicKey===settings.intentPostKey))fail('INVALID_INPUT');
    // Validate any authentic history key, even if outside the bounded editor options.
    const owned=await tx.query<{activity_key:string}>('SELECT DISTINCT activity_key FROM seeking_posts WHERE profile_id=$1 AND activity_key=ANY($2::text[])',[actor.id,settings.selectedActivities]);
    if(settings.selectedActivities.some(key=>!owned.rows.some(r=>r.activity_key===key)))fail('INVALID_INPUT');
    await tx.query('INSERT INTO social_profile_spaces(profile_id,customization) VALUES($1,$2::jsonb) ON CONFLICT(profile_id) DO UPDATE SET customization=EXCLUDED.customization,updated_at=clock_timestamp()',[actor.id,JSON.stringify(settings)]);
   }
   // Retention and expiry can remove editor choices. Normalize only the read DTO;
   // explicit submissions above still reject unavailable or unowned selections.
   const customization=settings??{...stored,
    intentPostKey:options.some(p=>p.publicKey===stored.intentPostKey)?stored.intentPostKey:null,
    selectedActivities:stored.selectedActivities.filter(key=>activities.some(a=>a.activityKey===key)),
   };
   const selected=customization.intentPostKey&&options.some(p=>p.publicKey===customization.intentPostKey)?await readPost(tx,customization.intentPostKey,actor.id):null;
   await reauthorize(tx,token,actor.id);
   return projectProfileSpace({identity:{alias:actor.alias,avatarSeed:actor.avatar_seed},audience:'self',privacyMode:actor.privacy_mode,customization,contextIntent:selected?intent(selected):null,activities,action:{kind:'seek',key:null},intentOptions:options});
  });
 }
 async context(token:string,kind:'discovery'|'connection'|'match',key:string):Promise<ProfileSpace>{
  parseSocialInput(publicKeySchema,key);
  return this.db.transaction(async tx=>{
   let actor=await requireProfile(tx,token);
   let pair:PairRow,peer:string;
   if(kind==='discovery') {const handle=await readHandle(tx,key,actor.id);const target=await postById(tx,handle.target_post_id);pair=await readPair(tx,handle.pair_id);peer=target.profile_id;if(peerId(pair,actor.id)!==peer)fail('NOT_FOUND');}
   else if(kind==='connection'){const request=await requestByKey(tx,key,actor.id);pair=await readPair(tx,request.pair_id);peer=peerId(pair,actor.id);}
   else {const match=await matchByKey(tx,key,actor.id);pair=await readPair(tx,match.pair_id);peer=peerId(pair,actor.id);}
   await lockProfiles(tx,[actor.id,peer]);actor=await reauthorize(tx,token,actor.id);const profile=await activeProfile(tx,peer);
   if(await isBlocked(tx,actor.id,peer))fail('NOT_FOUND');
   let action:ProfileSpace['action'],contextIntent:CurrentIntent|null=null,audience:ProfileSpace['audience']='stranger';
   let mode:ProfileRow['privacy_mode'];
   if(kind==='discovery'){
    const handle=await readHandle(tx,key,actor.id);pair=await readPair(tx,handle.pair_id);
    const source=await postById(tx,handle.source_post_id),target=await postById(tx,handle.target_post_id);
    if(source.profile_id!==actor.id||target.profile_id!==peer||peerId(pair,actor.id)!==peer)fail('NOT_FOUND');activePost(source);activePost(target);
    if((await tx.query('SELECT 1 FROM discovery_passes WHERE viewer_profile_id=$1 AND target_profile_id=$2',[actor.id,peer])).rows.length)fail('NOT_FOUND');
    const ranked=rankCompatible(await candidate(tx,source,actor),[await candidate(tx,target,profile)],{now:new Date().toISOString(),limit:1});if(!ranked.length)fail('NOT_FOUND');
    const request=(await tx.query<RequestRow>(`SELECT * FROM connection_requests WHERE pair_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[pair.id])).rows[0];
    if(request){action=await requestAction(tx,request);audience=request.status==='accepted'?'connection':'stranger';}else action={kind:'interest',key};
    mode=strongerMode(await pairPostMode(tx,pair,profile),target.privacy_mode);contextIntent=intent(target,target.activity_label,ranked[0]!.timeHint);
   }else{
    let request:RequestRow;
    if(kind==='connection'){request=await requestByKey(tx,key,actor.id);pair=await readPair(tx,request.pair_id);if(peerId(pair,actor.id)!==peer)fail('NOT_FOUND');action=await requestAction(tx,request);}
    else{const match=await matchByKey(tx,key,actor.id);if(match.status!=='active')fail('NOT_FOUND');pair=await readPair(tx,match.pair_id);if(peerId(pair,actor.id)!==peer)fail('NOT_FOUND');request=(await tx.query<RequestRow>('SELECT * FROM connection_requests WHERE id=$1 AND pair_id=$2',[match.request_id,pair.id])).rows[0]??fail('NOT_FOUND');if(request.status!=='accepted')fail('NOT_FOUND');action={kind:'chat',key};}
    audience=request.status==='accepted'?'connection':'stranger';
    const peerPostId=request.sender_profile_id===peer?request.source_post_id:request.target_post_id;
    if(peerPostId){const post=await postById(tx,peerPostId);if(post.profile_id!==peer)fail('NOT_FOUND');contextIntent=intent(post,request.activity_label);}
    if(request.status==='pending'){
     if(!request.source_post_id||!request.target_post_id)fail('NOT_FOUND');const source=await postById(tx,request.source_post_id),target=await postById(tx,request.target_post_id);if(source.profile_id!==request.sender_profile_id||target.profile_id!==request.recipient_profile_id)fail('NOT_FOUND');activePost(source);activePost(target);
     const sender=source.profile_id===actor.id?actor:profile,recipient=target.profile_id===actor.id?actor:profile;
     if(!rankCompatible(await candidate(tx,source,sender),[await candidate(tx,target,recipient)],{now:new Date().toISOString(),limit:1}).length)fail('NOT_FOUND');
    }
    mode=await pairPostMode(tx,pair,profile);
   }
   const customization=await readCustomization(tx,peer);
   const activities=mode==='INCOGNITO'||(mode==='PRIVATE'&&audience==='stranger')?[]:await history(tx,peer,customization.selectedActivities);
   const identity=await pairIdentity(tx,pair,{...profile,privacy_mode:mode});await reauthorize(tx,token,actor.id);
   return projectProfileSpace({identity,audience,privacyMode:mode,customization,contextIntent,activities,action});
  });
 }
}
