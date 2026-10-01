"use client";
import { useEffect,useState } from 'react';
import type { ModerationReport,ModerationEvidence,ModerationAction } from './service';
type Case={report:ModerationReport;evidence:ModerationEvidence};
async function api(path:string,method='GET',body?:unknown){
 const response=await fetch(`/api/moderation/${path}`,{method,credentials:'same-origin',cache:'no-store',...(body!==undefined?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error?.message??'Moderation is temporarily unavailable.');
 return data;
}
export function ModerationScreen(){
 const [authenticated,setAuthenticated]=useState(false),[checking,setChecking]=useState(true),[secret,setSecret]=useState(''),[reports,setReports]=useState<ModerationReport[]>([]),[current,setCurrent]=useState<Case|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{let live=true;void api('session').then(async()=>{const queue=await api('reports');if(live){setAuthenticated(true);setReports(queue.reports);}}).catch(()=>{}).finally(()=>{if(live)setChecking(false);});return()=>{live=false;};},[]);
 async function perform(work:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Moderation is temporarily unavailable.');}finally{setBusy(false);}}
 async function action(input:ModerationAction){if(!current)return;await perform(async()=>{const data=await api(`reports/${current.report.publicKey}`,'PATCH',input);setCurrent({...current,report:data.report});setReports(rows=>rows.map(row=>row.publicKey===data.report.publicKey?data.report:row));setNotice('Moderator action saved.');});}
 const buttonStyle={padding:'0.7rem',border:'1px solid #9ca3af',borderRadius:8,background:'#fff',color:'#111',cursor:'pointer'};
 return <main style={{maxWidth:760,margin:'0 auto',padding:'24px 16px',overflowWrap:'anywhere'}}>
  <h1>Human moderation</h1><p>Review reported context and choose a proportionate action. Restrictions apply to the reported profile and persist after recovery.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {checking?<p>Checking moderator access…</p>:!authenticated?<form onSubmit={event=>{event.preventDefault();const submitted=secret;setSecret('');void perform(async()=>{await api('session','POST',{secret:submitted});const queue=await api('reports');setReports(queue.reports);setAuthenticated(true);});}}>
   <label htmlFor="admin-secret">Admin secret</label><input id="admin-secret" type="password" value={secret} autoComplete="current-password" required maxLength={256} onChange={e=>setSecret(e.target.value)} style={{display:'block',width:'100%',maxWidth:400,boxSizing:'border-box',margin:'8px 0',padding:12}}/>
   <button style={buttonStyle} disabled={busy}>Sign in</button>
  </form>:<>
   <div style={{display:'flex',flexWrap:'wrap',gap:8}}><button style={buttonStyle} disabled={busy} onClick={()=>void perform(async()=>{const data=await api('reports');setReports(data.reports);setCurrent(null);})}>Refresh queue</button><button style={buttonStyle} disabled={busy} onClick={()=>void perform(async()=>{await api('session','DELETE');setAuthenticated(false);setReports([]);setCurrent(null);})}>Sign out</button></div>
   <h2>Report queue</h2><p>Up to 30 open or reviewing reports, oldest first.</p>
   {!reports.length&&<p>No open reports.</p>}
   <ol style={{paddingLeft:22}}>{reports.map(report=><li key={report.publicKey} style={{marginBottom:16}}><strong>{report.reason}</strong> · {report.status}<p>{report.text??'No additional report text.'}</p><button style={buttonStyle} disabled={busy} onClick={()=>void perform(async()=>setCurrent(await api(`reports/${report.publicKey}`)))}>Review report</button></li>)}</ol>
   {current&&<section aria-label="Report evidence"><h2>Reported context</h2><p>Case status: {current.report.status}. Evidence was preserved when this report was filed.</p>
    {current.evidence.profiles.map(profile=><p key={profile.role}>{profile.label}</p>)}
    {current.evidence.posts.map((post,index)=><p key={index}>{post.role}: {post.activityLabel} · {post.interactionMode} · {post.format}</p>)}
    <h3>Recent reported conversation</h3><p>Last 20 messages at report time. Contact disclosures and exact availability are excluded.</p>
    <ol style={{paddingLeft:22}}>{current.evidence.messages.map((message,index)=><li key={index}><strong>{message.role}</strong><p style={{whiteSpace:'pre-wrap'}}>{message.text}</p></li>)}</ol>
    <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({status:'reviewing'})}>Mark reviewing</button>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({canSeek:false,status:'resolved'})}>Restrict new posts</button>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({canConnect:false,status:'resolved'})}>Restrict new connections</button>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({moderationStatus:'suspended',status:'resolved'})}>Suspend reported profile</button>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({moderationStatus:'active',canSeek:true,canConnect:true,status:'resolved'})}>Restore profile access</button>
     <button style={buttonStyle} disabled={busy} onClick={()=>void action({status:'dismissed'})}>Dismiss report</button>
    </div>
   </section>}
  </>}
 </main>;
}
