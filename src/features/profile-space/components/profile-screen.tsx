'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/features/entry/client';
import { socialApi, useSocialAction, type Profile } from '@/features/social/client';
import { SocialShell, SocialError, SocialLiveStatus } from '@/features/social/components/common';
import { ProfilePanel } from '@/features/social/components/profile-panel';
import { useSocialRefresh } from '@/features/realtime/client';
import type { ProfileSpace } from '../schema';
import { ProfileScene } from './profile-scene';
import { ProfileEditor } from './profile-editor';

export type ProfileContext='discovery'|'connection'|'match';
export function ProfileScreen({editor=false,context,contextKey}:{editor?:boolean;context?:ProfileContext;contextKey?:string}){
 const [space,setSpace]=useState<ProfileSpace|null>(null);
 const [profile,setProfile]=useState<Profile|null>(null);
 const [loaded,setLoaded]=useState(false),[unavailable,setUnavailable]=useState(false),[restricted,setRestricted]=useState(false);
 const [notice,setNotice]=useState('');
 const action=useSocialAction(),background=useSocialAction();
 const {run:runBackground}=background;
 const generation=useRef(0);
 const own=!context;
 const read=useCallback(async(alive:()=>boolean)=>{
  const current=++generation.current;
  const valid=()=>alive()&&generation.current===current;
  try{
   if(own){
    const result=await socialApi<{profile:Profile|null}>('/profile');
    if(!valid())return;
    setProfile(result.profile);
    if(!result.profile){setSpace(null);setUnavailable(false);setRestricted(false);return;}
   }
   const result=await socialApi<{space:ProfileSpace}>(own?'/profile/space':`/profiles/${context}/${encodeURIComponent(contextKey??'')}`);
   if(valid()){setSpace(result.space);setUnavailable(false);setRestricted(false);}
  }catch(error){
   if(!valid())return;
   if(error instanceof ApiError&&[401,403,404].includes(error.status)){
    setSpace(null);setProfile(null);setUnavailable(!own);setRestricted(own&&error.status===403);
   }else throw error;
  }finally{if(valid())setLoaded(true);}
 },[own,context,contextKey]);
 const {run}=action;
 useEffect(()=>{const tracker=generation;void run(read);return()=>{++tracker.current;};},[read,run]);
 const refresh=useCallback(()=>runBackground(read),[runBackground,read]);
 const live=useSocialRefresh(['match','connections','discovery'],refresh,{enabled:!!space&&!action.busy&&!editor});
 function onProfile(value:Profile|null){
  ++generation.current;setProfile(value);if(!editor||!value)setSpace(null);setRestricted(false);
  if(value)void background.run(read);
 }
 const title=editor?'Настроить профиль':own?'Ваше пространство':'Пространство для знакомства';
 return <SocialShell title={title} navigation={false}>
  {!loaded&&<div className="profile-skeleton" role="status"><span/><span/><span/>Загружаем пространство…</div>}
  <SocialError message={action.error??background.error} focusRef={action.error? action.errorRef:background.errorRef}/>
  {(action.error||background.error)&&<button className="button button-secondary" disabled={action.busy} onClick={()=>void action.run(read)}>Попробовать снова</button>}
  {loaded&&unavailable&&<section className="profile-unavailable"><h2>Профиль сейчас недоступен</h2><p>Перейдите к своим занятиям или запросам. Эта ссылка больше не открывает пространство для знакомства.</p><Link className="button button-secondary" href="/discover">Вернуться к занятиям</Link></section>}
  {loaded&&own&&!profile&&!space&&!(action.error||background.error)&&<ProfilePanel profile={null} onProfile={onProfile} restricted={restricted}/>}
  {space&&<>
   <SocialLiveStatus {...live}/>
   {!own&&<p className="quiet-copy">Видны только сведения, разрешённые для этого знакомства. В режиме «Инкогнито» оформление и псевдоним относятся к вашей паре.</p>}
   {editor&&own?<ProfileEditor space={space} onSave={async settings=>{
    const result=await socialApi<{space:ProfileSpace}>('/profile/space','PATCH',settings);
    setSpace(result.space);
   }}/>:<ProfileScene space={space}>
    {own?<><Link className="button button-primary" href="/profile/edit">Настроить профиль</Link><Link className="button button-secondary" href="/seek/new">Добавить занятие</Link><Link className="social-text-button" href="/preferences">Мои правила</Link></>:space.action.kind==='interest'?<button className="button button-primary" disabled={action.busy} onClick={()=>void action.run(async alive=>{
     await socialApi('/connections','POST',{handle:space.action.key});
     if(alive()){setNotice('Предложение отправлено. Ответ появится в запросах.');setSpace({...space,action:{kind:'connections',key:null}});}
    })}>Предложить что-нибудь</button>:space.action.kind==='chat'?<Link className="button button-primary" href={`/m/${encodeURIComponent(space.action.key??'')}`}>Открыть чат</Link>:space.action.kind==='connections'?<Link className="button button-primary" href="/connections">Посмотреть запрос</Link>:null}
   </ProfileScene>}
   {notice&&<p role="status">{notice}</p>}
   {editor&&<Link className="social-text-button" href="/profile">Посмотреть свой профиль</Link>}
   {own&&profile&&<details className="profile-account-settings"><summary>Приватность, Ключ Intavro и управление профилем</summary><ProfilePanel profile={profile} onProfile={onProfile}/></details>}
  </>}
 </SocialShell>;
}
