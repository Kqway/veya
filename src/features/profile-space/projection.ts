import { ACCENTS, AVATARS, PROFILE_WORLDS, profileSpaceSchema, type ActivitySummary, type CurrentIntent, type Customization, type ProfileSpace, type Presentation } from './schema';
import type { PrivacyMode } from '@/features/social/client';

/** Incognito presentation depends only on the already-random pair avatar seed.
 * Never incorporate internal identity, global settings, or cross-pair history. */
export function projectPresentation(settings:Customization,mode:PrivacyMode,identity:ProfileSpace['identity']):Presentation {
 if(mode!=='INCOGNITO')return {world:settings.world,accent:settings.accent,avatar:settings.avatar};
 const n=[...identity.avatarSeed].reduce((value,ch)=>(value*31+ch.charCodeAt(0))>>>0,0);
 return {world:PROFILE_WORLDS[n%PROFILE_WORLDS.length]!,accent:ACCENTS[(n>>>4)%ACCENTS.length]!,avatar:AVATARS[(n>>>8)%AVATARS.length]!};
}
export type ProjectionInput={
 identity:ProfileSpace['identity'];audience:ProfileSpace['audience'];privacyMode:PrivacyMode;
 customization:Customization;contextIntent:CurrentIntent|null;activities:ActivitySummary[];
 action:ProfileSpace['action'];intentOptions?:{publicKey:string;activityLabel:string}[];
};
export function projectProfileSpace(input:ProjectionInput):ProfileSpace {
 const {customization:s,audience,privacyMode,identity}=input;
 const self=audience==='self';
 const allowed=(field:keyof Customization['visibility'])=>self||
  (privacyMode!=='INCOGNITO' && !(privacyMode==='PRIVATE'&&audience==='stranger') &&
  (s.visibility[field]==='everyone'||(s.visibility[field]==='connection'&&audience==='connection')));
 // The current scoped activity is already permitted by discovery/connection DTOs.
 // Its raw text, location and exact windows are never passed to this function.
 const visibleBlocks=s.blockOrder.filter(block=>s.enabledBlocks.includes(block)&&
  (block==='intent'&&!self?!!input.contextIntent:allowed(block)));
 const intentEnabled=self?s.enabledBlocks.includes('intent'):true;
 const blockOrder=privacyMode==='INCOGNITO'&&!self?['intent' as const]:visibleBlocks;
 return profileSpaceSchema.parse({
  identity:{alias:identity.alias,avatarSeed:identity.avatarSeed},audience,
  presentation:self?{world:s.world,accent:s.accent,avatar:s.avatar}:projectPresentation(s,privacyMode,identity),
  status:allowed('status')?(s.status||null):null,tagline:allowed('tagline')?(s.tagline||null):null,
  currentIntent:intentEnabled?input.contextIntent:null,
  activities:visibleBlocks.includes('activities')&&allowed('activities')?input.activities.filter(a=>s.selectedActivities.includes(a.activityKey)).slice(0,6):[],
  interests:visibleBlocks.includes('interests')&&allowed('interests')?[...s.interests]:[],
  goals:visibleBlocks.includes('goals')&&allowed('goals')?[...s.goals]:[],blockOrder,
  action:{kind:input.action.kind,key:input.action.key},
  ...(self?{customization:s,intentOptions:input.intentOptions??[],activityOptions:input.activities.slice(0,20)}:{}),
 });
}
/** Editor-only self projection. A newly selected intent is shown with its known
 * label; unknown format/time are not inferred from the previous selected post. */
export function projectSelfPreview(space:ProfileSpace,settings:Customization):ProfileSpace {
 const option=space.intentOptions?.find(i=>i.publicKey===settings.intentPostKey);
 const same=space.customization?.intentPostKey===settings.intentPostKey;
 const contextIntent=settings.intentPostKey===null?null:same?space.currentIntent:option?{activityLabel:option.activityLabel,interactionMode:'either' as const,format:'either' as const,timeHint:null}:null;
 return projectProfileSpace({identity:space.identity,audience:'self',privacyMode:'OPEN',customization:settings,contextIntent,activities:space.activityOptions??space.activities,action:space.action,intentOptions:space.intentOptions??[]});
}
