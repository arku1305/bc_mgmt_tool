const accountingStyle={padding:11,border:'1px solid #3d4e47',borderRadius:8,background:'#111a18',color:'#edf4f0',fontSize:16,maxWidth:'100%',boxSizing:'border-box'};
const accountingButton={...accountingStyle,background:'#213e32',cursor:'pointer',fontSize:14};
const accountingMoney=c=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(c/100);
const accountingToday=()=>new Date(Date.now()+28800000).toISOString().slice(0,10);
const accountingCategories={income:['臨打費','固定預繳','其他收入'],expense:['場地費','球費','退款','其他支出']};
async function accountingRequest(method,body) {
  const user=firebase.auth().currentUser;
  if(!user)throw new Error('請先登入');
  const token=await user.getIdToken();
  const res=await fetch((window.ROSTER_API_URL||'https://badminton-signup-bot.vercel.app')+'/api/registration-admin?scope=accounting',{method,cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const result=await res.json();if(!res.ok)throw new Error(result.message||'帳務操作失敗');return result;
}
function AccountingDialogFrame({title,onClose,children}) {
  const ref=React.useRef(null);
  React.useEffect(()=>{
    const previous=document.activeElement;
    const element=ref.current;
    element?.focus();
    return()=>{if(previous?.isConnected)previous.focus();};
  },[]);
  function keyDown(e){
    if(e.key==='Escape'){e.preventDefault();onClose();}
    if(e.key==='Tab'){
      const elements=Array.from(ref.current.querySelectorAll('button,input,select,textarea,[tabindex="0"]')).filter(el=>!el.disabled&&el.getClientRects().length);
      const first=elements[0],last=elements[elements.length-1];
      if(!first){e.preventDefault();return;}
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===ref.current)){e.preventDefault();first.focus();}
    }
  }
  return <div style={{position:'fixed',inset:0,zIndex:260,background:'#000b',display:'flex',alignItems:'center',justifyContent:'center',padding:12}}>
    <section ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={keyDown} style={{width:820,maxWidth:'100%',maxHeight:'90dvh',overflowY:'auto',background:'#17231e',color:'#edf4f0',border:'1px solid #466253',borderRadius:16,padding:22,boxSizing:'border-box'}}>
      <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:16}}><h2 style={{fontSize:22,margin:0}}>{title}</h2><button type="button" style={accountingButton} aria-label="關閉帳務視窗" onClick={onClose}>✕</button></header>
      {children}
    </section>
  </div>;
}
function AccountingEditor({initial,onSaved,onClose}) {
  const [draft,setDraft]=React.useState(initial),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[dirty,setDirty]=React.useState(false);
  const title=draft.action==='import'?'確認活動收入':draft.action==='edit'?'編輯帳目':'新增帳目';
  const aggregate=draft.action==='import'||!!draft.members;
  const included=aggregate?draft.entries:draft.entries.filter(e=>e.include);
  const invalid=included.some(e=>!e.name.trim()||!/^\d+(\.\d{1,2})?$/.test(String(e.amount))||Number(e.amount)>100000000);
  const total=AccountingView.sum(included.map(e=>({...e,amountCents:Math.round((Number(e.amount)||0)*100)})));
  function update(key,value){setDraft({...draft,[key]:value});setDirty(true);setError('');}
  function entry(index,patch){update('entries',draft.entries.map((e,i)=>i===index?{...e,...patch}:e));}
  function close(){if(busy)return;if(!dirty||confirm('放棄尚未儲存的修改？'))onClose();}
  async function save(){
    setBusy(true);setError('');
    try{const result=await accountingRequest('POST',{action:draft.action,id:draft.id,source:draft.source,fingerprint:draft.fingerprint,title:draft.title,date:draft.date,entries:included,confirmed:true,expectedRevision:draft.revision});onSaved(result);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function removeRecord(){
    if(!confirm('刪除「'+draft.title+'」整份帳目？所有款項將自結餘移除，刪除後無法復原。'))return;
    setBusy(true);setError('');
    try{onSaved(await accountingRequest('POST',{action:'delete',id:draft.id,confirmed:true,expectedRevision:draft.revision}));}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <AccountingDialogFrame title={title} onClose={close}>
    {error&&<p role="alert" style={{color:'#ffb5b5'}}>{error}</p>}
    {draft.action==='import'&&<p style={{color:'#a5bcb0',fontSize:14}}>來源：{draft.source.kind==='ranking'?'排點名單':'球團報名名單'}。請核對本場人員與實收金額，確認後合併為一筆活動收入。固定預繳者預設 0 元，預繳款另記。</p>}
    <fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}><label style={{display:'grid',gap:6,flex:'1 1 240px'}}>帳目名稱<input style={accountingStyle} maxLength={100} value={draft.title} onChange={e=>update('title',e.target.value)}/></label><label style={{display:'grid',gap:6}}>記帳日期<input style={accountingStyle} type="date" value={draft.date} onInput={e=>update('date',e.target.value)} onChange={e=>update('date',e.target.value)}/></label></div>
      <div style={{display:'grid',gap:10}}>{draft.entries.map((e,i)=><div key={i} style={{padding:14,border:'1px solid #344b3e',borderRadius:10,background:e.include?'#1d3026':'#131f19'}}>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          {!aggregate&&<label><input type="checkbox" aria-label={'入帳 '+(e.name||'明細 '+(i+1))} checked={!!e.include} onChange={v=>entry(i,{include:v.target.checked})}/> 入帳</label>}
          <input aria-label={'明細名稱 '+(i+1)} style={{...accountingStyle,flex:'1 1 160px',minWidth:0}} placeholder="球員／項目名稱" maxLength={100} value={e.name} onChange={v=>entry(i,{name:v.target.value})}/>
          <label style={{display:'flex',alignItems:'center',gap:6}}>$<input aria-label={'金額 '+(i+1)} style={{...accountingStyle,width:125}} type="number" min="0" max="100000000" step="0.01" placeholder="金額" value={e.amount} onChange={v=>entry(i,{amount:v.target.value})}/></label>
          <button type="button" style={{...accountingButton,padding:'8px 10px',color:'#ffb5b5'}} aria-label={'移除 '+(e.name||'明細 '+(i+1))} onClick={()=>update('entries',draft.entries.filter((_,n)=>n!==i))}>移除</button>
        </div>
        {!aggregate&&<div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginTop:10}}>
          <select aria-label={'收支 '+(i+1)} style={{...accountingStyle,fontSize:14,padding:8}} value={e.type} onChange={v=>entry(i,{type:v.target.value,category:accountingCategories[v.target.value][0]})}><option value="income">收入</option><option value="expense">支出</option></select>
          <select aria-label={'分類 '+(i+1)} style={{...accountingStyle,fontSize:14,padding:8}} value={e.category} onChange={v=>entry(i,{category:v.target.value})}>{accountingCategories[e.type].map(c=><option key={c}>{c}</option>)}</select>
          <input aria-label={'備註 '+(i+1)} style={{...accountingStyle,fontSize:14,padding:8,flex:'1 1 180px',minWidth:0}} placeholder="備註（選填）" maxLength={500} value={e.note||''} onChange={v=>entry(i,{note:v.target.value})}/>
          {e.participantType&&<small style={{color:'#a5bcb0'}}>{e.participantType==='fixed'?'固定':'臨打'}{e.paid?' · 排點已標記繳費':''}</small>}
        </div>}
        {aggregate&&e.participantType==='fixed'&&<small style={{color:'#a5bcb0'}}>固定成員 · 預繳款不重複計入本場</small>}
      </div>)}</div>
      <button type="button" style={{...accountingButton,marginTop:12}} onClick={()=>update('entries',[...draft.entries,{name:'',type:aggregate?'income':'expense',category:aggregate?'臨打費':'場地費',amount:'',note:'',include:true}])}>{aggregate?'新增人員':'新增明細'}</button>
      <div style={{padding:16,marginTop:16,borderRadius:10,background:'#254532'}}><strong>{aggregate?'本場人員 '+included.length+' 位':'已選 '+included.length+' 筆'}</strong><p style={{margin:'8px 0 0'}}>{aggregate?<>合計收入 ${accountingMoney(total.income)} · 入帳為 1 筆活動收入</>:<>收入 ${accountingMoney(total.income)} · 支出 ${accountingMoney(total.expense)} · 結餘 ${accountingMoney(total.income-total.expense)}</>}</p></div>
      {invalid&&<p style={{color:'#ffcf83'}}>請補齊人員／明細的名稱與金額；未填金額不代表零元。</p>}
      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button type="button" style={{...accountingButton,background:'#8ff3b5',color:'#12311f',fontWeight:700,opacity:invalid||!included.length?0.5:1}} disabled={!included.length||invalid||!draft.title.trim()||!draft.date} onClick={save}>{busy?'儲存中…':draft.action==='edit'?'確認儲存修改':'確認正式入帳'}</button><button type="button" style={accountingButton} onClick={close}>取消</button>{draft.action==='edit'&&<button type="button" style={{...accountingButton,color:'#ffb5b5',marginLeft:'auto'}} onClick={removeRecord}>刪除整份帳目</button>}</div>
    </fieldset>
  </AccountingDialogFrame>;
}
function AccountingImportDialog({source,onClose,onSaved}) {
  const [draft,setDraft]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const [date,setDate]=React.useState(accountingToday()),[label,setLabel]=React.useState('');
  const standalone=source.kind==='ranking'&&!source.clubId;
  async function preview(input){
    setBusy(true);setError('');
    try{
      const [data,result]=await Promise.all([accountingRequest('GET'),accountingRequest('POST',{action:'preview',source:input})]);
      if(data.records.some(r=>r.id===result.id))throw new Error('這場活動已入帳，請至帳務管理編輯原帳目。');
      setDraft({...result,source:input,action:'import',revision:data.revision});
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  React.useEffect(()=>{if(!standalone)preview(source);},[]);
  if(draft)return <AccountingEditor initial={draft} onClose={onClose} onSaved={onSaved}/>;
  return <AccountingDialogFrame title="匯入活動收入" onClose={()=>{if(!busy)onClose();}}>
    {error&&<p role="alert" style={{color:'#ffb5b5'}}>{error}</p>}
    {standalone?<form onSubmit={e=>{e.preventDefault();preview({...source,date,label});}}>
      <p style={{color:'#a5bcb0'}}>獨立排點請先填寫本次活動；相同日期與名稱視為同一場。</p>
      <fieldset disabled={busy} style={{display:'grid',gap:14,border:0,padding:0}}><label style={{display:'grid',gap:6}}>活動日期<input type="date" required max={accountingToday()} style={accountingStyle} value={date} onInput={e=>setDate(e.target.value)} onChange={e=>setDate(e.target.value)}/></label><label style={{display:'grid',gap:6}}>活動名稱<input required maxLength={100} style={accountingStyle} value={label} onChange={e=>setLabel(e.target.value)} placeholder="例如週六晚場"/></label><button style={accountingButton}>{busy?'讀取中…':'預覽人員與金額'}</button></fieldset>
    </form>:<>{busy?<p role="status">正在讀取本次活動名單與費用…</p>:<button style={accountingButton} onClick={()=>preview(source)}>重新讀取預覽</button>}</>}
  </AccountingDialogFrame>;
}
function AccountingAdmin() {
  const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[draft,setDraft]=React.useState(null);
  const [from,setFrom]=React.useState(''),[to,setTo]=React.useState(''),[query,setQuery]=React.useState(''),[page,setPage]=React.useState(1);
  async function load(){setBusy(true);setError('');try{setData(await accountingRequest('GET'));}catch(e){setError(e.message);}finally{setBusy(false);}}
  React.useEffect(()=>{let active=true;accountingRequest('GET').then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  const statement=AccountingView.statement(data?.records||[],{from,to,query,page});
  function filter(setter,value){setter(value);setPage(1);}
  function saved(result){setData({...data,...result});setDraft(null);}
  function edit(r){setDraft({...r,action:'edit',revision:data.revision,entries:(r.members||r.entries).map(e=>({...e,amount:e.amountCents/100,include:true}))});setError('');}
  return <section aria-label="帳務管理" style={{flex:1,overflowY:'auto',padding:'24px 18px',color:'#edf4f0'}}>
    <style>{`.accounting-statement{width:100%;border-collapse:collapse;text-align:left}.accounting-statement th{font-size:13px;color:#a5bcb0;font-weight:500;padding:14px 12px;border-bottom:1px solid #354b3e}.accounting-statement td{padding:16px 12px;border-bottom:1px solid #2a3a31;vertical-align:top}.accounting-statement .date{white-space:nowrap;width:112px;font-size:14px;color:#b7c8be}.accounting-statement .amount{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:17px;font-weight:600}.accounting-statement .item-button{border:0;padding:0;background:none;color:#edf4f0;text-align:left;cursor:pointer;font-size:15px;line-height:1.5}.accounting-statement small{display:block;color:#9ab0a1;font-size:12px;line-height:1.5;margin-top:4px}.accounting-statement tbody tr:hover{background:#203329}@media(max-width:560px){.accounting-statement th,.accounting-statement td{padding:14px 6px}.accounting-statement .date{width:78px;min-width:78px;white-space:nowrap;font-size:12px}.accounting-statement .amount{font-size:15px}.accounting-statement .item-button{font-size:14px}}`}</style>
    <div style={{maxWidth:1000,margin:'0 auto'}}>
      <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:18}}><h1 style={{fontSize:24,margin:0}}>帳務管理</h1><button style={accountingButton} disabled={!data||busy} onClick={()=>setDraft({action:'create',title:'',date:accountingToday(),revision:data.revision,entries:[{name:'',type:'income',category:'其他收入',amount:'',note:'',include:true}]})}>＋ 新增款項</button></header>
      {error&&<p role="alert" style={{color:'#ffb5b5'}}>{error} <button style={accountingButton} onClick={load}>重新讀取</button></p>}
      <article aria-label="總結餘" style={{padding:'26px 24px',borderRadius:16,background:'linear-gradient(125deg,#285b3d,#1b392c)',border:'1px solid #4a765c',marginBottom:24}}>
        <div style={{fontSize:14,color:'#c6dfd0'}}>總結餘 <span style={{fontSize:12,color:'#b2cbbc'}}>TWD</span></div><div style={{fontSize:'clamp(34px,6vw,48px)',fontWeight:700,fontVariantNumeric:'tabular-nums',margin:'8px 0 20px'}}>{data?'$ '+accountingMoney(data.totals.balanceCents):'—'}</div>
        <div style={{display:'flex',gap:36,flexWrap:'wrap',fontSize:13,color:'#c6dfd0'}}><span>累計收入 <strong style={{display:'block',color:'#edf4f0',fontSize:18,marginTop:4}}>{data?'$ '+accountingMoney(data.totals.incomeCents):'—'}</strong></span><span>累計支出 <strong style={{display:'block',color:'#edf4f0',fontSize:18,marginTop:4}}>{data?'$ '+accountingMoney(data.totals.expenseCents):'—'}</strong></span></div>
      </article>
      <article style={{background:'#16231c',border:'1px solid #32483a',borderRadius:14,padding:'18px 14px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:16}}><h2 style={{fontSize:18,margin:0}}>收支明細</h2></div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'end'}}><label style={{display:'grid',gap:6,fontSize:13,color:'#a5bcb0'}}>開始日期<input style={{...accountingStyle,padding:8}} type="date" value={from} onInput={e=>filter(setFrom,e.target.value)} onChange={e=>filter(setFrom,e.target.value)}/></label><label style={{display:'grid',gap:6,fontSize:13,color:'#a5bcb0'}}>結束日期<input style={{...accountingStyle,padding:8}} type="date" value={to} onInput={e=>filter(setTo,e.target.value)} onChange={e=>filter(setTo,e.target.value)}/></label><input aria-label="搜尋帳目" style={{...accountingStyle,padding:8,flex:'1 1 160px',minWidth:0}} placeholder="搜尋項目或活動" value={query} onChange={e=>filter(setQuery,e.target.value)}/>{(from||to||query)&&<button style={accountingButton} onClick={()=>{setFrom('');setTo('');setQuery('');setPage(1);}}>清除篩選</button>}</div>
        {from&&to&&from>to&&<p role="alert" style={{color:'#ffcf83'}}>開始日期不能晚於結束日期。</p>}
        <div style={{display:'flex',gap:16,flexWrap:'wrap',fontSize:12,color:'#a5bcb0',padding:'16px 0'}}><span>{statement.count} 筆明細</span><span>篩選收入 ${accountingMoney(statement.total.income)}</span><span>篩選支出 ${accountingMoney(statement.total.expense)}</span></div>
        <table className="accounting-statement"><thead><tr><th scope="col" className="date">日期</th><th scope="col">項目</th><th scope="col" className="amount">金額</th></tr></thead><tbody>
          {statement.rows.map(({record:r,entry:e,index,key})=><tr key={key}><td className="date">{r.date}</td><td><button className="item-button" aria-label={'查看 '+e.name+' '+r.date} onClick={()=>edit(r)}>{e.name}<small>{r.members?e.category+' · '+r.members.length+' 位':r.title+' · '+e.category}</small></button></td><td className="amount" style={{color:e.type==='income'?'#8ff3b5':'#edf4f0'}}>{e.type==='income'?'+':'−'}{accountingMoney(e.amountCents)}</td></tr>)}
          {!statement.count&&<tr><td colSpan={3} style={{textAlign:'center',padding:36,color:'#a5bcb0'}}>{data?'尚無符合條件的明細':'正在讀取帳務…'}</td></tr>}
        </tbody></table>
        {statement.pages>1&&<nav aria-label="帳務分頁" style={{display:'flex',justifyContent:'center',alignItems:'center',gap:16,paddingTop:18}}><button style={accountingButton} disabled={statement.page===1} onClick={()=>setPage(statement.page-1)}>上一頁</button><span style={{fontSize:13}}>{statement.page} / {statement.pages}</span><button style={accountingButton} disabled={statement.page===statement.pages} onClick={()=>setPage(statement.page+1)}>下一頁</button></nav>}
      </article>
      {draft&&<AccountingEditor initial={draft} onClose={()=>setDraft(null)} onSaved={saved}/>}
    </div>
  </section>;
}
