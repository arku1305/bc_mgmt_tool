function ClubRegistrationAdmin({ onImport, onAccounting, canImportRanking = true }) {
  const [clubs,setClubs] = React.useState([]), [clubId,setClubId] = React.useState(''), [eventId,setEventId] = React.useState('');
  const selectionKey='registrationSelection:'+firebase.auth().currentUser.uid;
  const [selectionReady,setSelectionReady]=React.useState(false);
  const [data,setData] = React.useState(null), [form,setForm] = React.useState(null), [error,setError] = React.useState('');
  const [busy,setBusy] = React.useState(false), [guest,setGuest] = React.useState('');
  const [deleteConfirm,setDeleteConfirm]=React.useState(false);
  const [guestError,setGuestError]=React.useState('');
  const [checkDate,setCheckDate] = React.useState('2026-10-10T09:00');
  const [historyId,setHistoryId] = React.useState('');
  const [copyError,setCopyError]=React.useState('');
  async function copyLink(value){setCopyError('');try{await navigator.clipboard.writeText(value);}catch(_){setCopyError('無法自動複製，請選取連結文字複製。');}}
  const base = window.ROSTER_API_URL || 'https://badminton-signup-bot.vercel.app';
  const style = {padding:12,borderRadius:8,border:'1px solid #42534a',background:'#10161d',color:'#edf4f0',fontSize:16};
  const button = {...style,background:'#22362c',cursor:'pointer'};
  const deleteButton={background:'transparent',border:0,color:'#f87171',padding:5,display:'inline-flex',cursor:'pointer',flexShrink:0};
  const memberCard={padding:14,background:'#1a2029',borderRadius:12,minWidth:0};
  const card = {padding:20,background:'#1a2029',borderRadius:12,marginBottom:18};
  async function request(method,body,id=clubId,event=eventId) {
    const token = await firebase.auth().currentUser.getIdToken();
    const url = base+'/api/registration-admin?scope=clubs&club='+encodeURIComponent(id)+'&event='+encodeURIComponent(event);
    const res = await fetch(url,{method,cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result = await res.json(); if(!res.ok) throw new Error(result.message || '操作失敗'); return result;
  }
  async function refreshClubs() { const result=await request('GET',null,'','');setClubs(result.clubs); return result.clubs; }
  React.useEffect(()=>{
    let active=true;
    request('GET',null,'','').then(result=>{
      if(!active)return;setClubs(result.clubs);
      let saved=null;try{saved=JSON.parse(localStorage.getItem(selectionKey)||'null');}catch(_){}
      if(saved&&typeof saved.clubId==='string'&&result.clubs.some(club=>club.clubId===saved.clubId)){
        setClubId(saved.clubId);setEventId(typeof saved.eventId==='string'?saved.eventId:'');
      }
      setSelectionReady(true);
    }).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[selectionKey]);
  React.useEffect(()=>{
    if(!selectionReady)return;
    try{localStorage.setItem(selectionKey,JSON.stringify({clubId,eventId}));}catch(_){}
  },[selectionKey,selectionReady,clubId,eventId]);
  React.useEffect(()=>{
    let active=true;setData(null);setError('');setGuestError('');
    if(!clubId)return;
    setBusy(true);
    request('GET').then(result=>{if(!active)return;setData(result);if(!eventId&&result.events.some(e=>!e.ended))setEventId(result.events.find(e=>!e.ended).eventId);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[clubId,eventId]);
  async function change(action,details={}) {
    if(['createClub','createEvent'].includes(action)&&Date.parse(details.fields.date+'T'+details.fields.startTime+':00+08:00')<=Date.now()){setError('活動開始時間已經過去，請選擇未來的日期與時間。');return;}
    setBusy(true);setError('');if(action==='addGuest')setGuestError('');
    try {
      const result=await request('POST',{action,expectedRevision:data?.revision,eventId,...details});
      if(action==='deleteClub') {await refreshClubs();setDeleteConfirm(false);setClubId('');setEventId('');setData(null);return;}
      setData(result);setForm(null);setGuest('');
      if(action==='createClub') {await refreshClubs();setClubId(result.clubId);}
      if(result.selectedEventId)setEventId(result.selectedEventId);
    } catch(e){if(action==='addGuest')setGuestError(e.message);else setError(e.message);} finally{setBusy(false);}
  }
  React.useEffect(()=>{
    const activity=data?.activity;if(!activity||!clubId)return;
    const delay=Date.parse(activity.date+'T'+activity.endTime+':00+08:00')-Date.now();if(!Number.isFinite(delay)||delay<=0)return;
    let active=true,timer;function schedule(){const remaining=Date.parse(activity.date+'T'+activity.endTime+':00+08:00')-Date.now();timer=setTimeout(()=>{if(!active)return;if(remaining>2147483647){schedule();return;}request('GET').then(result=>{if(active)setData(result);}).catch(()=>{});},Math.min(Math.max(20,remaining+20),2147483647));}schedule();
    return()=>{active=false;clearTimeout(timer);};
  },[clubId,eventId,data?.activity?.date,data?.activity?.endTime]);
  function start(mode) {
    const defaults=data?.defaults || {};
    const a=mode==='edit'?data.activity:{};
    setForm({mode,name:mode==='createClub'?'':data.name,date:a.date||'',startTime:a.startTime||defaults.startTime||'20:00',endTime:a.endTime||defaults.endTime||'22:00',location:a.location||defaults.location||'',totalCapacity:a.totalCapacity||defaults.totalCapacity||16,guestFee:mode==='edit'?(a.guestFee??''):(defaults.guestFee??''),fixedFee:mode==='edit'?(a.fixedFee??''):(defaults.fixedFee??''),fixedNames:mode==='createClub'?'':(defaults.fixedMembers||[]).join('\n'),frequency:mode==='edit'?a.frequency:(defaults.frequency||'once'),leadDays:defaults.leadDays??3,untilDate:'',courtCount:a.courtCount||defaults.courtCount||2,shuttlecock:a.shuttlecock||defaults.shuttlecock||'',message:a.message??defaults.message??''});
  }
  function field(key,value){setForm({...form,[key]:value});if(key==='date'||key==='startTime')setError('');}
  const todayTaiwan=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
  const pastStart=!!form&&form.mode!=='edit'&&Date.parse(form.date+'T'+form.startTime+':00+08:00')<=Date.now();
  const visibleEvents=(data?.events||[]).filter(event=>!event.ended);
  const endedEvents=(data?.events||[]).filter(event=>event.ended);
  const historyEvent=endedEvents.find(event=>event.eventId===historyId)||endedEvents[0];
  React.useEffect(()=>{
    if(data&&!visibleEvents.some(event=>event.eventId===eventId)){
      const next=visibleEvents[0]?.eventId||'';if(next!==eventId)setEventId(next);
    }
  },[data,eventId]);
  const attendingFixed=(data?.fixed||[]).filter(p=>!p.onLeave);
  const a=data?.activity?.ended ? null : data?.activity;
  const link=new URL(window.SIGNUP_PAGE_URL||base+'/');link.searchParams.delete('event');link.searchParams.delete('series');if(data?.publicToken)link.searchParams.set('team',data.publicToken);
  const eventLink=new URL(link);if(a?.recurrenceId)eventLink.searchParams.set('series',a.recurrenceId);else if(a)eventLink.searchParams.set('event',a.eventId);
  return <section aria-label="多球團報名管理" style={{flex:1,overflowY:'auto',padding:24,color:'#edf4f0'}}><div style={{maxWidth:1000,margin:'0 auto'}}>
    <h1>報名管理</h1>
    {error&&<p role="alert" style={{...card,color:'#ffb5b5'}}>{error}<button style={button} onClick={()=>request('GET').then(setData).catch(e=>setError(e.message))}>重新整理</button></p>}
    <div style={{display:'flex',gap:12,marginBottom:20}}>
      <select style={{...style,flex:1,minWidth:0}} aria-label="我的球團" value={clubId} disabled={busy} onChange={e=>{setClubId(e.target.value);setEventId('');}}><option value="">請選擇球團</option>{clubs.map(c=><option key={c.clubId} value={c.clubId}>{c.name}</option>)}</select>
      <button style={button} disabled={busy} onClick={()=>start('createClub')}>新增球團與首場活動</button>
    </div>
    {data&&<div style={{display:'flex',gap:12,marginBottom:20}}>
      <select style={{...style,flex:1,minWidth:0}} aria-label="活動" value={eventId} disabled={busy} onChange={e=>setEventId(e.target.value)}><option value="">{visibleEvents.length?'請選擇活動':'目前沒有未結束的活動'}</option>{visibleEvents.map(e=><option key={e.eventId} value={e.eventId}>{e.eventTime} · {e.ended?'已結束':e.registrationOpen?'開放':'暫停'}</option>)}</select>
      <button style={button} disabled={busy} onClick={()=>start('createEvent')}>建立新活動</button>
    </div>}
    {!clubs.length&&<p>尚未建立球團，先新增球團與首場活動。</p>}
    {window.LINE_INTEGRATION_V2&&<LineManagementPanel clubId={clubId} eventId={eventId} onChanged={async()=>{if(clubId)setData(await request('GET'));}} />}
    {a&&<article style={card}><h2>球友報名連結</h2><div style={{display:'flex',gap:12,alignItems:'center'}}><a href={eventLink.toString()} target="_blank" rel="noopener noreferrer" style={{color:'#8ff3b5',overflowWrap:'anywhere',minWidth:0,flex:1}}>{eventLink.toString()}</a><button type="button" style={{...button,display:'flex',flexShrink:0}} aria-label="複製球友報名連結" title="複製球友報名連結" onClick={()=>copyLink(eventLink.toString())}><CopyIcon/></button></div>{copyError&&<p role="alert">{copyError}</p>}</article>}
    {a&&<>
      <article style={card}><h2>{data.name} · {a.eventTime}</h2><p>{a.location} · 名額 {a.totalCapacity} 人 · 剩餘 {data.remaining} 位 · 臨打 {a.guestFee==null?'費用未設定':'$'+a.guestFee}</p><p>{a.frequency==='weekly'?'固定每週自動開團':'單次活動'} · {a.ended?'已結束，停止報名':a.waiting?'等待本系列前場結束或開放日':a.registrationOpen?'開放報名':'暫停報名'}</p>
        <button style={button} disabled={busy} onClick={()=>start('edit')}>編輯本場</button> <button style={button} disabled={busy||a.ended||a.waiting} onClick={()=>change('setOpen',{open:!a.registrationOpen})}>{a.registrationOpen?'暫停報名':'開放報名'}</button>
        {canImportRanking&&<> {' '}<button style={button} disabled={busy} onClick={()=>onImport({clubId,eventId,publicToken:data.publicToken})}>匯入排點</button></>}
        {onAccounting&&<> {' '}<button style={{...button,opacity:busy||!a.ended?0.45:1,cursor:busy||!a.ended?'not-allowed':'pointer'}} disabled={busy||!a.ended} aria-describedby={!a.ended?'accounting-import-status':undefined} title={!a.ended?'活動結束後才能匯入帳務':undefined} onClick={()=>onAccounting({kind:'registration',clubId,eventId})}>匯入帳務</button>{!a.ended&&<p id="accounting-import-status" style={{color:'#a5bcb0',fontSize:14,margin:'12px 0 0'}}>活動結束後才能匯入帳務；已結束場次請至下方「已結束活動」選擇匯入。</p>}</>}

      </article>
      <div aria-label="活動成員名單" style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:12,marginBottom:18}}>
        <article style={memberCard}><h2 style={{fontSize:19,margin:'4px 0 18px'}}>固定成員</h2>{data.fixed.map((p,i)=><div key={p.name} style={{display:'flex',gap:6,alignItems:'center',marginBottom:14}}><div style={{flex:1,minWidth:0,overflowWrap:'anywhere'}}>{!p.onLeave&&<span>{data.fixed.slice(0,i+1).filter(x=>!x.onLeave).length}. </span>}{p.name}<small style={{color:'#a5bcb0',display:'block',marginTop:4}}>共請假 {p.leaveCount||0} 次{p.onLeave?' · 本場請假':''}</small></div>{p.onLeave?<button style={{...button,padding:6,fontSize:12}} disabled={busy} onClick={()=>change('restoreFixed',{name:p.name})}>恢復參加</button>:<button type="button" style={deleteButton} aria-label={'刪除固定成員 '+p.name+' 本場名單'} title="刪除本場名單並計一次請假" disabled={busy} onClick={()=>{if(confirm('刪除 '+p.name+' 本場名單並計一次請假？後續場次仍預設參加。'))change('leaveFixed',{name:p.name});}}><DeleteIcon/></button>}</div>)}</article>
        <article style={memberCard}><h2 style={{fontSize:19,margin:'4px 0 18px'}}>臨打名單</h2>{data.guests.map((p,i)=><div key={p.name} style={{display:'flex',gap:6,alignItems:'center',marginBottom:14}}><span style={{flex:1,minWidth:0,overflowWrap:'anywhere'}}>{attendingFixed.length+i+1}. {p.name}</span><button type="button" style={deleteButton} aria-label={'刪除臨打 '+p.name} title="刪除本場報名" disabled={busy} onClick={()=>{if(confirm('刪除 '+p.name+' 本場報名？排點資料會保留。'))change('removeGuest',{name:p.name,time:p.time});}}><DeleteIcon/></button></div>)}<form style={{display:'flex',gap:8,flexWrap:'wrap'}} onSubmit={e=>{e.preventDefault();change('addGuest',{name:guest});}}><input aria-label="臨打姓名" placeholder="臨打姓名" style={{...style,width:'100%',minWidth:0,boxSizing:'border-box'}} required maxLength={40} value={guest} onChange={e=>{setGuest(e.target.value);setGuestError('');}}/><button style={{...button,padding:8}} disabled={busy}>新增</button>{guestError&&<p role="alert" style={{color:'#ffb5b5',margin:'8px 0 0',overflowWrap:'anywhere'}}>{guestError}</p>}</form></article>
      </div>
    </>}
    {historyEvent&&(onAccounting||canImportRanking)&&<article style={card}><h2>已結束活動</h2><div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
      <label>活動 <select aria-label="已結束活動" style={style} disabled={busy} value={historyEvent.eventId} onChange={e=>setHistoryId(e.target.value)}>{endedEvents.map(event=><option key={event.eventId} value={event.eventId}>{event.eventTime}</option>)}</select></label>
      {canImportRanking&&<button style={button} disabled={busy} onClick={()=>onImport({clubId,eventId:historyEvent.eventId,publicToken:data.publicToken})}>匯入排點</button>}
      {onAccounting&&<button style={button} disabled={busy} onClick={()=>onAccounting({kind:'registration',clubId,eventId:historyEvent.eventId})}>匯入帳務</button>}
    </div></article>}
    {data?.series.length>0&&<article style={card}><h2>每週開團系列</h2>{data.series.map(s=><p key={s.id}>{s.anchorDate} 至 {s.untilDate||'未設定迄日'} · {s.startTime}–{s.endTime} · 提前 {s.leadDays} 天 · {s.untilDate&&s.untilDate<todayTaiwan?'已達迄日':s.enabled?'自動開團中':'已暫停續開'} <button style={button} disabled={busy} onClick={()=>change('setSeries',{seriesId:s.id,enabled:!s.enabled})}>{s.enabled?'暫停續開':'恢復續開'}</button></p>)}<p>暫停續開會保留已建立的活動與報名。</p></article>}
    {window.ISOLATED_CLUB_PREVIEW&&data&&<article style={card}><h2>本機排程測試</h2><p>用虛構時間執行同一套排程，檢查下一場與重跑結果。</p><label>排程檢查時間<input style={style} type="datetime-local" value={checkDate} onInput={e=>setCheckDate(e.target.value)} onChange={e=>setCheckDate(e.target.value)}/></label> <button style={button} disabled={busy} onClick={()=>change('previewAdvance',{now:new Date(checkDate+':00+08:00').getTime()})}>執行模擬排程</button></article>}
    {data&&<div style={{marginTop:24,marginBottom:24}}><button style={{...button,color:'#ffb5b5',borderColor:'#854747'}} disabled={busy} onClick={()=>setDeleteConfirm(true)}>刪除球團</button></div>}
    {deleteConfirm&&data&&<div style={{position:'fixed',inset:0,zIndex:230,background:'#000b',display:'flex',alignItems:'center',justifyContent:'center',padding:18}}><section role="dialog" aria-modal="true" aria-label="確認刪除球團" style={{...card,maxWidth:460}}><h2>刪除「{data.name}」？</h2><p>刪除後會從球團清單移除、停止自動開團，原報名連結及 LINE 活動連結也會停止使用。歷史名單與排點資料會保留存檔。</p>{error&&<p role="alert" style={{color:'#ffb5b5'}}>{error}</p>}<button style={{...button,color:'#ffb5b5'}} disabled={busy} onClick={()=>change('deleteClub')}>{busy?'處理中…':'確認刪除球團'}</button> <button style={button} disabled={busy} onClick={()=>setDeleteConfirm(false)}>取消</button></section></div>}
    {form&&<div style={{position:'fixed',inset:0,zIndex:205,background:'#000b',display:'flex',alignItems:'center',justifyContent:'center',padding:18}}><form role="dialog" aria-label={form.mode==='createClub'?'新增球團':form.mode==='edit'?'編輯本場活動':'建立新活動'} style={{...card,width:560,maxHeight:'85vh',overflowY:'auto'}} onSubmit={e=>{e.preventDefault();change(form.mode,{fields:{...form,totalCapacity:Number(form.totalCapacity),guestFee:form.guestFee===''?null:Number(form.guestFee),fixedFee:form.fixedFee===''?null:Number(form.fixedFee),courtCount:Number(form.courtCount),leadDays:Number(form.leadDays),fixedMembers:form.fixedNames.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean)}});}}>
      <h2>{form.mode==='createClub'?'新增球團與首場活動':form.mode==='edit'?'編輯本場活動':'建立新活動'}</h2><div style={{display:'grid',gap:14}}>
        {form.mode==='createClub'&&<><label>球團名稱<input style={style} required maxLength={60} value={form.name} onChange={e=>field('name',e.target.value)}/></label><label>固定成員（每行一位）<textarea style={style} rows={3} value={form.fixedNames} onChange={e=>field('fixedNames',e.target.value)}/></label></>}
        {form.mode==='createEvent'&&<label>固定成員（每行一位）<textarea style={style} rows={4} value={form.fixedNames} onChange={e=>field('fixedNames',e.target.value)}/></label>}
        <label>活動日期<input style={style} type="date" required min={form.mode==='edit'?undefined:todayTaiwan} value={form.date} onInput={e=>field('date',e.target.value)} onChange={e=>field('date',e.target.value)}/></label>
        {['startTime','endTime'].map((key,i)=><label key={key}>{i?'結束時間':'開始時間'}<input style={style} type="time" required value={form[key]} onInput={e=>field(key,e.target.value)} onChange={e=>field(key,e.target.value)}/></label>)}
        {pastStart&&<p role="alert" style={{color:'#ffb5b5',margin:0}}>活動開始時間已經過去，請選擇未來的日期與時間。</p>}
        <label>場地<input style={style} required maxLength={120} value={form.location} onChange={e=>field('location',e.target.value)}/></label>
        {[['totalCapacity','總名額',1,200],['guestFee','臨打費用',0,100000],['fixedFee','固定球友計費基準',0,100000],['courtCount','場地數',1,20]].map(([key,label,min,max])=><label key={key}>{label}{key.includes('Fee')?'（選填）':''}<input style={style} type="number" required={!key.includes('Fee')} min={min} max={max} step={key.includes('Fee')?'0.01':'1'} value={form[key]} onChange={e=>field(key,e.target.value)}/></label>)}
        <label>用球（選填）<input style={style} maxLength={100} value={form.shuttlecock} onChange={e=>field('shuttlecock',e.target.value)}/></label><label>公告補充文字（選填）<textarea style={style} rows={3} maxLength={600} value={form.message} onChange={e=>field('message',e.target.value)}/></label>
        {form.mode!=='edit'&&<><label>開團頻率<select style={style} value={form.frequency} onChange={e=>field('frequency',e.target.value)}><option value="once">單次</option><option value="weekly">固定每週</option></select></label>{form.frequency==='weekly'&&<><label>迄日<input style={style} type="date" required min={form.date||todayTaiwan} value={form.untilDate} onInput={e=>field('untilDate',e.target.value)} onChange={e=>field('untilDate',e.target.value)}/></label><label>提前幾天開放下一場<input style={style} type="number" min={0} max={28} required value={form.leadDays} onChange={e=>field('leadDays',e.target.value)}/></label><p>建立一個每週系列；前場結束且到提前開放日後，自動建立下一場，活動日期不超過迄日；此期間用於統計固定成員請假次數。</p></>}</>}
      </div><p>{form.mode==='createClub'?'本次資料會成為球團預設。':'本次修改只影響這一場，不改球團預設或其他場次。'}</p>{error&&<p role="alert">{error}</p>}<button style={button} disabled={busy||pastStart}>{form.mode==='edit'?'儲存本場':'建立並開放報名'}</button> <button style={button} type="button" disabled={busy} onClick={()=>setForm(null)}>返回</button>
    </form></div>}
  </div></section>;
}
