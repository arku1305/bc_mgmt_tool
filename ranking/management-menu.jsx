function ManagementMenu({role,access,view,onSelect,onLogout}) {
  const [open,setOpen]=React.useState(false);
  const modules=[['registration','報名管理'],['ranking','排點管理'],['accounting','帳務管理'],['permissions','權限管理']].filter(([key])=>key==='permissions'?role==='platformAdmin':access[key]!==false);
  const button={padding:'12px 16px',border:0,borderRadius:8,color:'#edf4f0',background:'#22362c',cursor:'pointer',fontSize:15};
  return <nav aria-label="團長管理導覽" style={{position:'relative',display:'flex',gap:12,padding:'10px 16px',background:'#17231d',color:'#edf4f0',alignItems:'center',zIndex:220}}>
    <button aria-label="開啟功能選單" aria-expanded={open} aria-controls="management-menu" style={button} onClick={()=>setOpen(!open)}>☰</button>
    <strong>揪凱JOKAI⎟球團管家</strong>
    {open&&<>
      <button aria-label="關閉功能選單" onClick={()=>setOpen(false)} style={{position:'fixed',inset:0,border:0,background:'#0005',zIndex:-1}} />
      <div id="management-menu" style={{position:'absolute',top:'100%',left:16,width:210,padding:10,display:'flex',flexDirection:'column',gap:6,background:'#1a2029',border:'1px solid #42534a',borderRadius:12,boxShadow:'0 12px 32px #0008'}}>
        {modules.map(([key,label])=><button key={key} aria-current={view===key?'page':undefined} style={{...button,textAlign:'left',background:view===key?'#345b42':'#22362c'}} onClick={()=>{onSelect(key);setOpen(false);}}>{label}</button>)}
        <button style={{...button,textAlign:'left'}} onClick={()=>{setOpen(false);onLogout();}}>登出</button>
      </div>
    </>}
  </nav>;
}
