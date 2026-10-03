"use client";
import { useEffect,useState } from 'react';
import type { ModerationReport,ModerationEvidence,ModerationAction } from './service';
const statusLabels:Record<ModerationReport['status'],string>={open:'Новая',reviewing:'На рассмотрении',resolved:'Решена',dismissed:'Отклонена'};
const reasonLabels:Record<string,string>={spam:'Спам',harassment:'Домогательства',unsafe_meeting:'Небезопасная встреча',impersonation:'Выдача себя за другого',other:'Другое'};
const roleLabels:Record<string,string>={reporter:'Автор жалобы',target:'Профиль, на который подана жалоба'};
const profileLabels:Record<string,string>={'Reporting participant':'Участник, подавший жалобу','Reported participant':'Участник, на которого подана жалоба'};
const modeLabels:Record<string,string>={online:'Онлайн',in_person:'Лично',either:'Любой вариант'};
const formatLabels:Record<string,string>={one_to_one:'Вдвоём',group:'Группа',either:'Любой вариант'};
type Case={report:ModerationReport;evidence:ModerationEvidence};
async function api(path:string,method='GET',body?:unknown){
 const response=await fetch(`/api/moderation/${path}`,{method,credentials:'same-origin',cache:'no-store',...(body!==undefined?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error?.message??'Модерация временно недоступна.');
 return data;
}
export function ModerationScreen(){
 const [authenticated,setAuthenticated]=useState(false),[checking,setChecking]=useState(true),[secret,setSecret]=useState(''),[reports,setReports]=useState<ModerationReport[]>([]),[current,setCurrent]=useState<Case|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;void api('session').then(async()=>{const queue=await api('reports');if(live){setAuthenticated(true);setReports(queue.reports);}}).catch(()=>{}).finally(()=>{if(live)setChecking(false);});return()=>{live=false;};},[]);
 async function perform(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError(e instanceof Error && /[А-Яа-яЁё]/u.test(e.message)?e.message:'Модерация временно недоступна. Попробуйте снова.');}finally{setBusy(false);}}
 async function action(input:ModerationAction){if(!current)return;await perform(async()=>{const data=await api(`reports/${current.report.publicKey}`,'PATCH',input);setCurrent({...current,report:data.report});setReports(rows=>rows.map(row=>row.publicKey===data.report.publicKey?data.report:row));setNotice('Действие модератора сохранено.');});}
 const buttonStyle={padding:'0.7rem',border:'1px solid #9ca3af',borderRadius:8,background:'#fff',color:'#111',cursor:'pointer'};
 return <main style={{maxWidth:760,margin:'0 auto',padding:'24px 16px',overflowWrap:'anywhere'}}>
  <h1>Модерация человеком</h1><p>Изучите материалы жалобы и выберите соразмерную меру. Ограничения применяются к профилю, на который подана жалоба, и сохраняются после восстановления доступа.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {checking?<p>Проверяем доступ модератора…</p>:!authenticated?<form onSubmit={event=>{event.preventDefault();const submitted=secret;setSecret('');void perform(async()=>{await api('session','POST',{secret:submitted});const queue=await api('reports');setReports(queue.reports);setAuthenticated(true);});}}>
   <label htmlFor="admin-secret">Секретный ключ администратора</label><input id="admin-secret" type="password" value={secret} autoComplete="current-password" required maxLength={256} onChange={e=>setSecret(e.target.value)} style={{display:'block',width:'100%',maxWidth:400,boxSizing:'border-box',margin:'8px 0',padding:12}}/>
   <button style={buttonStyle} disabled={busy}>Войти</button>
  </form>:<>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}><button style={buttonStyle} disabled={busy} onClick={()=>void perform(async()=>{const data=await api('reports');setReports(data.reports);setCurrent(null);})}>Обновить очередь</button><button style={buttonStyle} disabled={busy} onClick={()=>void perform(async()=>{await api('session','DELETE');setAuthenticated(false);setReports([]);setCurrent(null);})}>Выйти</button></div>
   <h2>Очередь жалоб</h2><p>До 30 новых жалоб или жалоб на рассмотрении, начиная с самых ранних.</p>
   {!reports.length&&<p>Новых жалоб нет.</p>}
   <ol style={{paddingLeft:22}}>{reports.map(report=><li key={report.publicKey} style={{marginBottom:16}}><strong>{reasonLabels[report.reason]??report.reason}</strong> · {statusLabels[report.status]}<p>{report.text??'Дополнительный текст жалобы отсутствует.'}</p><button style={buttonStyle} disabled={busy} onClick={()=>void perform(async()=>setCurrent(await api(`reports/${report.publicKey}`)))}>Рассмотреть жалобу</button></li>)}</ol>
   {current&&<section aria-label="Материалы жалобы"><h2>Контекст жалобы</h2><p>Статус жалобы: {statusLabels[current.report.status]}. Материалы были сохранены при подаче жалобы.</p>
    {current.evidence.profiles.map(profile=><p key={profile.role}>{profileLabels[profile.label]??profile.label}</p>)}
    {current.evidence.posts.map((post,index)=><p key={index}>{roleLabels[post.role]??post.role}: {post.activityLabel} · {modeLabels[post.interactionMode]??post.interactionMode} · {formatLabels[post.format]??post.format}</p>)}
    <h3>Последние сообщения из диалога, на который подана жалоба</h3><p>Последние 20 сообщений на момент подачи жалобы. Контактные данные и точное время доступности исключены.</p>
    <ol style={{paddingLeft:22}}>{current.evidence.messages.map((message,index)=><li key={index}><strong>{roleLabels[message.role]??message.role}</strong><p style={{whiteSpace:'pre-wrap'}}>{message.text}</p></li>)}</ol>
    <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({status:'reviewing'})}>Взять на рассмотрение</button>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({canSeek:false,status:'resolved'})}>Запретить новые объявления</button>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({canConnect:false,status:'resolved'})}>Запретить новые запросы</button>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({moderationStatus:'suspended',status:'resolved'})}>Приостановить доступ к профилю</button>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({moderationStatus:'active',canSeek:true,canConnect:true,status:'resolved'})}>Восстановить доступ к профилю</button>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({status:'dismissed'})}>Отклонить жалобу</button>
    </div>
   </section>}
  </>}
 </main>;
}
