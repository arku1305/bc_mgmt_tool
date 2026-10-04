function LineManagementPanel({clubId='',eventId='',onChanged}) {
  const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
  const [choices,setChoices]=React.useState([]),[player,setPlayer]=React.useState('organizer');
  const [simulation,setSimulation]=React.useState({group:'group-a',text:'加入揪凱'}),[messages,setMessages]=React.useState([]),[privateText,setPrivateText]=React.useState('綁定團長');
  const style={padding:10,borderRadius:8,border:'1px solid #42534a',background:'#10161d',color:'#edf4f0',fontSize:16},button={...style,cursor:'pointer'};
  const endpoint=(window.ROSTER_API_URL||'https://badminton-signup-bot.vercel.app')+'/api/registration-admin?scope=line&club='+encodeURIComponent(clubId)+'&event='+encodeURIComponent(eventId);
  async function request(body) {
    const token=await firebase.auth().currentUser.getIdToken();
    const res=await fetch(endpoint,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result=await res.json();if(!res.ok)throw new Error(result.message||'操作失敗');return result;
  }
  React.useEffect(()=>{
    if(busy)return;
    let active=true,inFlight=false;
    async function refresh(){if(inFlight)return;inFlight=true;try{const result=await request();if(active){setData(result);setError('');}}catch(e){if(active)setError(e.message);}finally{inFlight=false;}}
    function returnToPage(){if(document.visibilityState==='visible')refresh();}
    refresh();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')refresh();},30000);
    window.addEventListener('focus',returnToPage);document.addEventListener('visibilitychange',returnToPage);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',returnToPage);document.removeEventListener('visibilitychange',returnToPage);};
  },[clubId,eventId,busy]);
  async function change(body) {setBusy(true);setError('');try{const result=await request(body);if(result.url){window.location.assign(result.url);return;}setData(result);if(body.action==='publication'&&onChanged)await onChanged();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function refreshGroups(){setBusy(true);setError('');try{setData(await request());}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function simulate(source,text,postback){setBusy(true);setError('');try{
    const token=await firebase.auth().currentUser.getIdToken();const res=await fetch('/api/preview-line',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({source,text,postback,player,group:simulation.group})});const result=await res.json();if(!res.ok)throw new Error(result.message);setMessages(result.messages||[]);setChoices(result.choices||[]);setData(await request());if(onChanged)await onChanged();
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  const params=new URLSearchParams(location.search),ticket=params.get('lineLink'),linkToken=params.get('linkToken');
  return <article aria-label="LINE 群組管理" style={{padding:20,background:'#1a2029',borderRadius:12,marginBottom:18,color:'#edf4f0'}}>
    <h2>LINE 群組管理</h2>{data&&!data.linked&&<p>請先私訊 Bot「綁定團長」。</p>}
    {ticket&&linkToken&&<><p>確認將目前登入的 Google 帳號與發起連結的 LINE 帳號綁定。可隨時解除。</p><button style={button} disabled={busy} onClick={()=>change({action:'prepareLink',ticket,linkToken})}>確認綁定並前往 LINE 驗證</button></>}
    {data?.linked&&<button style={button} disabled={busy} onClick={()=>change({action:'unlink'})}>解除我的 LINE 綁定</button>}
    {error&&<p role="alert" style={{color:'#ffb5b5'}}>{error} <button style={button} disabled={busy} onClick={refreshGroups}>重試</button></p>}
    {!!data?.groups.reduce((n,g)=>n+(g.requests||[]).length,0)&&<p role="status">有 {data.groups.reduce((n,g)=>n+(g.requests||[]).length,0)} 筆共用申請待處理</p>}
    {data?.groups.map(g=><section key={g.key} style={{borderTop:'1px solid #42534a',paddingTop:12,marginTop:12}}><h3>{g.name}</h3><p>{!g.active?'Bot 已離群':g.usable?'可使用':g.status==='rejected'?'申請未通過':'等待原登錄團長同意'}</p>
      {g.owner&&g.requests.map(r=><p key={r.uid}>申請者：{r.email} <button style={button} disabled={busy} onClick={()=>change({action:'review',groupKey:g.key,requester:r.uid,decision:'approve'})}>同意共用</button> <button style={button} disabled={busy} onClick={()=>change({action:'review',groupKey:g.key,requester:r.uid,decision:'reject'})}>拒絕共用</button></p>)}
      {clubId&&eventId&&g.usable&&(()=>{const p=data.publications.find(p=>p.groupKey===g.key);return <><button style={button} disabled={busy} onClick={()=>change({action:'publication',clubId,eventId,groupKey:g.key,active:!p?.active})}>{p?.active?'停止本場與此群連結':'連結本場活動到此群'}</button>{p?.active&&!p.ready&&<button style={button} disabled={busy} onClick={()=>change({action:'publication',clubId,eventId,groupKey:g.key,active:true})}>更新本場群組連結</button>}{p?.active&&<><p>到這個群輸入：<strong>{p.command}</strong></p>{p.status!=='sent'&&<p>{p.status==='failed'?'送出失敗，請重新輸入指令':p.status==='sending'?'處理中／尚未確認送出':'等待群內指令'}</p>}</>}</>;})()}
    </section>)}
    {window.ISOLATED_CLUB_PREVIEW&&<section style={{marginTop:20,borderTop:'1px solid #42534a',paddingTop:16}}><h3>本機 LINE 模擬器</h3><p>只用虛構身分，不連 LINE、不發真實訊息。模擬綁定會走一次性連結及成功回呼檢查。</p>
      <label>私訊指令<input style={style} value={privateText} onChange={e=>setPrivateText(e.target.value)}/></label> <button style={button} disabled={busy} onClick={()=>simulate('user',privateText)}>模擬私訊與驗證</button><br/>
      <label>測試群組<select style={style} value={simulation.group} onChange={e=>setSimulation({...simulation,group:e.target.value})}><option value="group-a">虛構群組 A</option><option value="group-b">虛構群組 B</option></select></label>
      <label>模擬發話者<select style={style} value={player} onChange={e=>setPlayer(e.target.value)}><option value="organizer">目前團長</option><option value="guest">一般球友甲（不綁定）</option><option value="other">一般球友乙（不綁定）</option></select></label><label>群內指令<input style={style} value={simulation.text} onChange={e=>setSimulation({...simulation,text:e.target.value})}/></label> <button style={button} disabled={busy} onClick={()=>simulate('group',simulation.text)}>模擬群內訊息</button>
      {choices.map(c=><button style={button} disabled={busy} key={c.data} onClick={()=>simulate('group','',c.data)}>{c.label}</button>)}
      {messages.map((m,i)=><pre key={i} style={{whiteSpace:'pre-wrap',fontFamily:'inherit',lineHeight:1.6}}>{m}</pre>)}
    </section>}
  </article>;
}
