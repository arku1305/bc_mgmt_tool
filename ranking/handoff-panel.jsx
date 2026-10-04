function ActivityHandoffPanel({onClose,onApplied,scope}) {
  const [draft,setDraft]=React.useState(null),[confirming,setConfirming]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const endpoint=(window.ROSTER_API_URL||'https://badminton-signup-bot.vercel.app')+'/api/roster-handoff'+(scope?'?club='+encodeURIComponent(scope.clubId)+'&event='+encodeURIComponent(scope.eventId):'');
  async function request(method,body){
    const user=firebase.auth().currentUser;if(!user)throw new Error('請先登入團長帳號');
    const response=await fetch(endpoint,{method,cache:'no-store',headers:{Authorization:'Bearer '+await user.getIdToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw new Error(result.message||'讀取失敗');return result;
  }
  React.useEffect(()=>{let active=true;request('GET').then(value=>{if(active)setDraft(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  async function overwrite(){
    if(busy)return;setBusy(true);setError('');
    try{
      const packet=await request('POST',{fingerprint:draft.fingerprint});
      window.RosterHandoff.validate(packet);
      const token=await firebase.auth().currentUser.getIdToken();
      const read=await fetch(rankingUrl(''),{cache:'no-store',headers:{'X-Firebase-ETag':'true',Authorization:'Bearer '+token}});
      if(!read.ok)throw new Error('無法讀取排點資料');const etag=read.headers.get('ETag');if(!etag)throw new Error('無法確認排點資料版本，暫停匯入');
      const data=await read.json()||{};
      const latest=await request('POST',{fingerprint:draft.fingerprint});
      if(latest.event.eventId!==packet.event.eventId||latest.revision!==packet.revision)throw new Error('報名名單已變更，請關閉後重新確認');
      const players=window.RosterHandoff.apply(packet,[],null,packet.roster.map(p=>p.registrationId),[],new Set(),[]);
      const previous={...data};delete previous.activityArchives;
      const next={...data,players,court1:{team1:[],team2:[]},court2:{team1:[],team2:[]},currentMatch:{courts:[{team1:[],team2:[]},{team1:[],team2:[]}]},roundNumbers:[1,1],
        activityArchives:{...(data.activityArchives||{}),['archive-'+Date.now()]:previous},
        eventIntegration:{...packet.event,revision:packet.revision,confirmedRoster:packet.roster,importedAt:Date.now()}};
      const response=await fetch(rankingUrl(''),{method:'PUT',headers:{'Content-Type':'application/json','If-Match':etag,Authorization:'Bearer '+await firebase.auth().currentUser.getIdToken()},body:JSON.stringify(next)});
      if(response.status===412)throw new Error('排點資料已被調整，尚未覆蓋；請關閉後重新確認');
      if(!response.ok)throw new Error('匯入未成功，請稍後重試');
      onApplied(players,next.eventIntegration,true);onClose();
    }catch(e){setError(e.message);setConfirming(false);}finally{setBusy(false);}
  }
  const button={padding:'10px 14px',borderRadius:8,border:'1px solid #506050',background:'#23362c',color:'#fff',cursor:'pointer'};
  return <div style={{position:'fixed',inset:0,zIndex:230,background:'#000b',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
    <section role="dialog" aria-modal="true" aria-label="活動與名單交接" style={{background:'#1a2029',color:'#fff',borderRadius:16,padding:24,width:520,maxWidth:'95vw',maxHeight:'88vh',overflowY:'auto'}}>
      <h2>{confirming?'確認覆蓋排點名單':'確認報名名單'}</h2>
      {error&&<p role="alert" style={{color:'#ffadad'}}>{error}</p>}
      {draft&&<><h3>{draft.event.eventTime}</h3><p>報名名單 {draft.roster.length} 人</p><ul>{draft.roster.map(p=><li key={p.registrationId}>{p.name} · {p.participantType==='fixed'?'固定球友':'臨打'}</li>)}</ul></>}
      {confirming?<><p>確定以這份名單覆蓋排點嗎？原球員名單將被取代，球員設定與場上安排會重設；原排點會先存檔。</p><button style={button} disabled={busy} onClick={overwrite}>{busy?'匯入中…':'確認覆蓋並匯入'}</button> <button style={button} disabled={busy} onClick={()=>setConfirming(false)}>返回</button></>:<button style={button} disabled={busy||!draft} onClick={()=>setConfirming(true)}>確認名單並匯入</button>}
      <button style={{...button,marginLeft:10}} disabled={busy} onClick={onClose}>關閉</button>
    </section>
  </div>;
}
