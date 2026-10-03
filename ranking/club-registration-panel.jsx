function ClubRegistrationAdmin({ onImport }) {
  const [clubs,setClubs] = React.useState([]), [clubId,setClubId] = React.useState(''), [eventId,setEventId] = React.useState('');
  const [data,setData] = React.useState(null), [form,setForm] = React.useState(null), [error,setError] = React.useState('');
  const [busy,setBusy] = React.useState(false), [notice,setNotice] = React.useState(''), [guest,setGuest] = React.useState('');
  const [checkDate,setCheckDate] = React.useState('2026-10-10T09:00');
  const base = window.ROSTER_API_URL || 'https://badminton-signup-bot.vercel.app';
  const style = {padding:12,borderRadius:8,border:'1px solid #42534a',background:'#10161d',color:'#edf4f0',fontSize:16};
  const button = {...style,background:'#22362c',cursor:'pointer'};
  const card = {padding:20,background:'#1a2029',borderRadius:12,marginBottom:18};
  async function request(method,body,id=clubId,event=eventId) {
    const token = await firebase.auth().currentUser.getIdToken();
    const url = base+'/api/registration-admin?scope=clubs&club='+encodeURIComponent(id)+'&event='+encodeURIComponent(event);
    const res = await fetch(url,{method,cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result = await res.json(); if(!res.ok) throw new Error(result.message || '操作失敗'); return result;
  }
  async function refreshClubs() { const result=await request('GET',null,'','');setClubs(result.clubs); return result.clubs; }
  React.useEffect(()=>{refreshClubs().catch(e=>setError(e.message));},[]);
  React.useEffect(()=>{
    let active=true;setData(null);setError('');
    if(!clubId)return;
    setBusy(true);
    request('GET').then(result=>{if(!active)return;setData(result);if(!eventId&&result.events.length)setEventId(result.events[0].eventId);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[clubId,eventId]);
  async function change(action,details={}) {
    setBusy(true);setError('');setNotice('');
    try {
      const result=await request('POST',{action,expectedRevision:data?.revision,eventId,...details});
      setData(result);setForm(null);setGuest('');setNotice('已儲存；未修改排點或帳務，也未發送 LINE 訊息。');
      if(action==='createClub') {await refreshClubs();setClubId(result.clubId);}
      if(result.selectedEventId)setEventId(result.selectedEventId);
    } catch(e){setError(e.message);} finally{setBusy(false);}
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
    setForm({mode,name:mode==='createClub'?'':data.name,date:a.date||'',startTime:a.startTime||defaults.startTime||'20:00',endTime:a.endTime||defaults.endTime||'22:00',location:a.location||defaults.location||'',totalCapacity:a.totalCapacity||defaults.totalCapacity||16,guestFee:mode==='edit'?(a.guestFee??''):(defaults.guestFee??''),fixedFee:mode==='edit'?(a.fixedFee??''):(defaults.fixedFee??''),fixedNames:mode==='createClub'?'':(defaults.fixedMembers||[]).join('\n'),frequency:mode==='edit'?a.frequency:(defaults.frequency||'once'),leadDays:defaults.leadDays??3,courtCount:a.courtCount||defaults.courtCount||2,shuttlecock:a.shuttlecock||defaults.shuttlecock||'',message:a.message??defaults.message??''});
  }
  function field(key,value){setForm({...form,[key]:value});}
  const a=data?.activity;
  const link=new URL(window.SIGNUP_PAGE_URL||base+'/');link.searchParams.delete('event');if(data?.publicToken)link.searchParams.set('team',data.publicToken);
  const eventLink=new URL(link);if(a)eventLink.searchParams.set('event',a.eventId);
  return <section aria-label="多球團報名管理" style={{flex:1,overflowY:'auto',padding:24,color:'#edf4f0'}}><div style={{maxWidth:1000,margin:'0 auto'}}>
    <h1>報名管理</h1><p>選擇自己的球團與活動，整理名單並預覽公告。</p>
    {error&&<p role="alert" style={{...card,color:'#ffb5b5'}}>{error}<button style={button} onClick={()=>request('GET').then(setData).catch(e=>setError(e.message))}>重新整理</button></p>}
    {notice&&<p role="status" style={card}>{notice}</p>}
    <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:20}}>
      <label>我的球團 <select style={style} aria-label="我的球團" value={clubId} disabled={busy} onChange={e=>{setClubId(e.target.value);setEventId('');setNotice('');}}><option value="">請選擇球團</option>{clubs.map(c=><option key={c.clubId} value={c.clubId}>{c.name}</option>)}</select></label>
      <button style={button} disabled={busy} onClick={()=>start('createClub')}>新增球團與首場活動</button>
      {data&&<label>活動 <select style={style} aria-label="活動" value={eventId} disabled={busy} onChange={e=>setEventId(e.target.value)}><option value="">請選擇活動</option>{data.events.map(e=><option key={e.eventId} value={e.eventId}>{e.eventTime} · {e.ended?'已結束':e.registrationOpen?'開放':'暫停'}</option>)}</select></label>}
      {data&&<button style={button} disabled={busy} onClick={()=>start('createEvent')}>建立新活動</button>}
    </div>
    {!clubs.length&&<p>尚未建立球團，先新增球團與首場活動。</p>}
    {window.LINE_INTEGRATION_V2&&<LineManagementPanel clubId={clubId} eventId={eventId} onChanged={async()=>{if(clubId)setData(await request('GET'));}} />}
    {a&&<>
      <article style={card}><h2>{data.name} · {a.eventTime}</h2><p>{a.location} · 名額 {a.totalCapacity} 人 · 剩餘 {data.remaining} 位 · 臨打 {a.guestFee==null?'費用未設定':'$'+a.guestFee}</p><p>{a.frequency==='weekly'?'固定每週自動開團':'單次活動'} · {a.ended?'已結束，停止報名':a.waiting?'等待本系列前場結束或開放日':a.registrationOpen?'開放報名':'暫停報名'}</p>
        <button style={button} disabled={busy} onClick={()=>start('edit')}>編輯本場</button> <button style={button} disabled={busy||a.ended||a.waiting} onClick={()=>change('setOpen',{open:!a.registrationOpen})}>{a.registrationOpen?'暫停報名':'開放報名'}</button>
        {' '}<button style={button} disabled={busy} onClick={()=>onImport({clubId,eventId,publicToken:data.publicToken})}>確認名單並匯入排點</button>
        <p>本場排點獨立保存。匯入先確認差異，保留團長人工新增與設定。</p>
      </article>
      <article style={card}><h2>球友報名連結</h2><p>本場活動：<a href={eventLink.toString()} target="_blank" rel="noopener noreferrer" style={{color:'#8ff3b5',overflowWrap:'anywhere'}}>{eventLink.toString()}</a></p></article>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:18}}>
        <article style={card}><h2>固定成員</h2>{data.fixed.map(p=><p key={p.name}>{p.name} · {p.onLeave?'請假':'參加'} <button style={button} disabled={busy} onClick={()=>change(p.onLeave?'restoreFixed':'leaveFixed',{name:p.name})}>{p.onLeave?'恢復參加':'請假'}</button></p>)}<p>按姓名辨識；恢復須有空位，仍保留固定價格。</p></article>
        <article style={card}><h2>臨打名單</h2>{data.guests.map(p=><p key={p.name}>{p.name} <button style={button} disabled={busy} onClick={()=>{if(confirm('取消 '+p.name+' 本場報名？排點資料會保留。'))change('removeGuest',{name:p.name,time:p.time});}}>取消本場報名</button></p>)}<form onSubmit={e=>{e.preventDefault();change('addGuest',{name:guest});}}><label>手動新增臨打<input style={style} required maxLength={40} value={guest} onChange={e=>setGuest(e.target.value)}/></label> <button style={button} disabled={busy}>新增</button></form></article>
      </div>
      <article style={card}><h2>LINE 公告預覽</h2><p>內容由本場資料產生；到已連結的群組輸入發布指令後，Bot 才回覆公告。</p><pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',lineHeight:1.7}}>{data.announcement}</pre></article>
    </>}
    {data?.series.length>0&&<article style={card}><h2>每週開團系列</h2>{data.series.map(s=><p key={s.id}>{s.anchorDate} 起 · {s.startTime}–{s.endTime} · 提前 {s.leadDays} 天 · {s.enabled?'自動開團中':'已暫停續開'} <button style={button} disabled={busy} onClick={()=>change('setSeries',{seriesId:s.id,enabled:!s.enabled})}>{s.enabled?'暫停續開':'恢復續開'}</button></p>)}<p>暫停續開會保留已建立的活動與報名。</p></article>}
    {window.ISOLATED_CLUB_PREVIEW&&data&&<article style={card}><h2>本機排程測試</h2><p>用虛構時間執行同一套排程，檢查下一場與重跑結果。</p><label>排程檢查時間<input style={style} type="datetime-local" value={checkDate} onInput={e=>setCheckDate(e.target.value)} onChange={e=>setCheckDate(e.target.value)}/></label> <button style={button} disabled={busy} onClick={()=>change('previewAdvance',{now:new Date(checkDate+':00+08:00').getTime()})}>執行模擬排程</button></article>}
    {form&&<div style={{position:'fixed',inset:0,zIndex:205,background:'#000b',display:'flex',alignItems:'center',justifyContent:'center',padding:18}}><form role="dialog" aria-label={form.mode==='createClub'?'新增球團':form.mode==='edit'?'編輯本場活動':'建立新活動'} style={{...card,width:560,maxHeight:'85vh',overflowY:'auto'}} onSubmit={e=>{e.preventDefault();change(form.mode,{fields:{...form,totalCapacity:Number(form.totalCapacity),guestFee:form.guestFee===''?null:Number(form.guestFee),fixedFee:form.fixedFee===''?null:Number(form.fixedFee),courtCount:Number(form.courtCount),leadDays:Number(form.leadDays),fixedMembers:form.fixedNames.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean)}});}}>
      <h2>{form.mode==='createClub'?'新增球團與首場活動':form.mode==='edit'?'編輯本場活動':'建立新活動'}</h2><div style={{display:'grid',gap:14}}>
        {form.mode==='createClub'&&<><label>球團名稱<input style={style} required maxLength={60} value={form.name} onChange={e=>field('name',e.target.value)}/></label><label>固定成員（每行一位）<textarea style={style} rows={3} value={form.fixedNames} onChange={e=>field('fixedNames',e.target.value)}/></label></>}
        <label>活動日期<input style={style} type="date" required value={form.date} onInput={e=>field('date',e.target.value)} onChange={e=>field('date',e.target.value)}/></label>
        {['startTime','endTime'].map((key,i)=><label key={key}>{i?'結束時間':'開始時間'}<input style={style} type="time" required value={form[key]} onInput={e=>field(key,e.target.value)} onChange={e=>field(key,e.target.value)}/></label>)}
        <label>場地<input style={style} required maxLength={120} value={form.location} onChange={e=>field('location',e.target.value)}/></label>
        {[['totalCapacity','總名額',1,200],['guestFee','臨打費用',0,100000],['fixedFee','固定球友計費基準',0,100000],['courtCount','場地數',1,20]].map(([key,label,min,max])=><label key={key}>{label}{key.includes('Fee')?'（選填）':''}<input style={style} type="number" required={!key.includes('Fee')} min={min} max={max} step={key.includes('Fee')?'0.01':'1'} value={form[key]} onChange={e=>field(key,e.target.value)}/></label>)}
        <label>用球（選填）<input style={style} maxLength={100} value={form.shuttlecock} onChange={e=>field('shuttlecock',e.target.value)}/></label><label>公告補充文字（選填）<textarea style={style} rows={3} maxLength={600} value={form.message} onChange={e=>field('message',e.target.value)}/></label>
        {form.mode!=='edit'&&<><label>開團頻率<select style={style} value={form.frequency} onChange={e=>field('frequency',e.target.value)}><option value="once">單次</option><option value="weekly">固定每週</option></select></label>{form.frequency==='weekly'&&<><label>提前幾天開放下一場<input style={style} type="number" min={0} max={28} required value={form.leadDays} onChange={e=>field('leadDays',e.target.value)}/></label><p>建立一個每週系列；前場結束且到提前開放日後，自動建立下一場，不發 LINE 推播。</p></>}</>}
      </div><p>{form.mode==='createClub'?'本次資料會成為球團預設。':'本次修改只影響這一場，不改球團預設或其他場次。'}</p>{error&&<p role="alert">{error}</p>}<button style={button} disabled={busy}>{form.mode==='edit'?'儲存本場':'建立並開放報名'}</button> <button style={button} type="button" disabled={busy} onClick={()=>setForm(null)}>返回</button>
    </form></div>}
  </div></section>;
}
