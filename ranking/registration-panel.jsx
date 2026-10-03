function RegistrationAdmin({ onImport }) {
  const [data, setData] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [form, setForm] = React.useState(null);
  const [guestName, setGuestName] = React.useState('');
  const base = (window.ROSTER_API_URL || 'https://badminton-signup-bot.vercel.app').replace(/\/$/, '');
  async function request(method, body) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('請先登入團長帳號');
    const response = await fetch(base + '/api/registration-admin', { method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + await user.getIdToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '報名管理暫時無法使用');
    return result;
  }
  async function load() {
    setBusy(true); setError('');
    try { setData(await request('GET')); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  React.useEffect(function() { load(); }, []);
  async function change(action, details, success) {
    if (busy || !data) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request('POST', { action, expectedRevision: data.revision, ...details });
      setData(result); setNotice(success); setForm(null); setGuestName('');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function edit(mode) {
    const a = data.activity;
    setForm({ mode, date: mode === 'edit' ? a.date : '', startTime: a.startTime || data.team?.startTime || '', endTime: a.endTime || data.team?.endTime || '', location: a.location || data.team?.location || '', totalCapacity: a.totalCapacity || data.team?.totalCapacity || '' });
    setError(''); setNotice('');
  }
  async function copyLink(url, label) {
    try { await navigator.clipboard.writeText(url); setNotice(label + '已複製，請自行貼到群組分享。'); }
    catch (_) { setNotice('請複製下方的報名連結。'); }
  }
  const button = { padding: '10px 15px', borderRadius: 9, border: '1px solid #42534a', background: '#22362c', color: '#b9f4d1', cursor: 'pointer', fontSize: 14 };
  const card = { background: '#1a2029', border: '1px solid #2b3440', padding: 22, borderRadius: 14, marginBottom: 18 };
  const input = { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #42534a', background: '#10161d', color: '#fff', fontSize: 16, marginTop: 6 };
  const field = (key, value) => setForm({ ...form, [key]: value });
  const exists = !!data?.activity.eventId;
  function setup() { setForm({ mode: 'setupTeam', name: '', date: '', startTime: '', endTime: '', location: '', totalCapacity: '', guestFee: '', fixedFee: '', fixedNames: '', frequency: 'once', intervalWeeks: 1, leadDays: 3 }); }
  const fixedUrl = new URL(window.SIGNUP_PAGE_URL || base + '/');
  if (data?.publicToken) fixedUrl.searchParams.set('team', data.publicToken);
  const fixedSignupUrl = fixedUrl.toString();
  const activityUrl = new URL(fixedSignupUrl);
  if (exists) activityUrl.searchParams.set('event', data.activity.eventId);
  const signupUrl = activityUrl.toString();
  return <section aria-label="團長報名管理" style={{ flex: 1, overflowY: 'auto', padding: '22px 16px', color: '#edf4f0' }}>
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div><h1 style={{ fontSize: 24, margin: '0 0 6px' }}>報名管理</h1><p style={{ margin: 0, color: '#a5b2aa' }}>開團、整理名單，確認後再交給排點。</p></div>
        <button style={button} disabled={busy} onClick={load}>重新整理名單</button>
      </div>
      {error && <p role="alert" style={{ ...card, borderColor: '#b76969', color: '#ffb5b5' }}>{error}　<button style={button} disabled={busy} onClick={load}>讀取最新資料</button></p>}
      {notice && <p role="status" style={{ ...card, color: '#b9f4d1' }}>{notice}</p>}
      {!data && !error && <p>讀取報名資料中…</p>}
      {data && <>
        <article style={card}>
          <h2 style={{ fontSize: 19, marginTop: 0 }}>{exists ? data.activity.eventTime : '尚未建立球團'}</h2>
          {exists && <><p>{data.activity.location}</p><p style={{ color: '#a5b2aa' }}>總名額 {data.activity.totalCapacity} 人 · 剩餘 {data.remaining} 位 · 臨打費用 ${data.activity.guestFee}</p>
            <p style={{ color: data.activity.registrationOpen ? '#b9f4d1' : '#ffd18d' }}>{data.activity.registrationOpen ? '報名開放中' : '目前暫停報名'}</p></>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {data.team ? <button style={button} disabled={busy} onClick={() => edit('create')}>建立新活動</button> : <button style={button} disabled={busy} onClick={setup}>建立球團</button>}
            {exists && <><button style={button} disabled={busy} onClick={() => edit('edit')}>編輯本次活動</button>
              <button style={button} disabled={busy} onClick={() => change('setOpen', { open: !data.activity.registrationOpen }, data.activity.registrationOpen ? '已暫停報名；原名單保留。' : '已開放報名。')}>{data.activity.registrationOpen ? '暫停報名' : '開放報名'}</button>
              <button style={button} disabled={busy} onClick={onImport}>確認名單並匯入排點</button></>}
          </div>
          <p style={{ color: '#a5b2aa', fontSize: 13, marginBottom: 0 }}>建立活動與名單調整不會自動發 LINE 訊息，也不會自動修改排點或帳務。</p>
        </article>
        {exists && <>
          <article style={card}><h2 style={{ fontSize: 18, marginTop: 0 }}>球友報名連結</h2>
            <h3 style={{ fontSize: 16 }}>球團固定連結（每週沿用）</h3>
            <p style={{ color: '#a5b2aa', fontSize: 14 }}>適合放群組記事本。開啟後顯示目前活動，請球友確認日期再報名。</p>
            <a href={fixedSignupUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#b9f4d1', overflowWrap: 'anywhere' }}>{fixedSignupUrl}</a>
            <div style={{ marginTop: 12 }}><button style={button} onClick={() => copyLink(fixedSignupUrl, '球團固定連結')}>複製球團固定連結</button></div>
            <h3 style={{ fontSize: 16, marginTop: 24 }}>本場活動連結</h3>
            <p style={{ color: '#a5b2aa', fontSize: 14 }}>只對應上方這場活動；換場後會提示使用新連結。</p>
            <a href={signupUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#b9f4d1', overflowWrap: 'anywhere' }}>{signupUrl}</a>
            <div style={{ marginTop: 12 }}><button style={button} onClick={() => copyLink(signupUrl, '本場活動連結')}>複製本場活動連結</button></div>
          </article>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
            <article style={card}><h2 style={{ fontSize: 18, marginTop: 0 }}>固定球友</h2>
              {data.fixed.map(p => <div key={p.name} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #2b3440' }}>
                <span>{p.name}<small style={{ display: 'block', color: p.onLeave ? '#ffd18d' : '#a5b2aa', marginTop: 4 }}>{p.onLeave ? '本次請假' : '預設參加'}</small></span>
                <button style={button} disabled={busy} onClick={() => change(p.onLeave ? 'restoreFixed' : 'leaveFixed', { name: p.name }, p.onLeave ? '已恢復參加，保留固定球友身分。' : '已登記本次請假；退款另由團長處理。')}>{p.onLeave ? '恢復參加' : '登記請假'}</button>
              </div>)}
              <p style={{ color: '#a5b2aa', fontSize: 13 }}>額滿時無法恢復參加。請假不代表已退款。</p>
            </article>
            <article style={card}><h2 style={{ fontSize: 18, marginTop: 0 }}>臨打名單（{data.guests.length} 人）</h2>
              {data.guests.length === 0 && <p style={{ color: '#a5b2aa' }}>目前沒有臨打報名。</p>}
              {data.guests.map((p, i) => <div key={p.name + ':' + i} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #2b3440' }}>
                <span>{i + 1}. {p.name}<small style={{ display: 'block', color: '#a5b2aa', marginTop: 4 }}>{p.source === 'web' ? '網頁報名' : p.source === 'manager' ? '團長新增' : 'LINE 報名'}</small></span>
                <button style={button} disabled={busy} onClick={() => { if (confirm('取消 ' + p.name + ' 本次報名？排點名單會保留，需另外匯入差異。')) change('removeGuest', { name: p.name, time: p.time }, '已取消報名；如已匯入排點，請再查看匯入差異。'); }}>取消報名</button>
              </div>)}
              <form onSubmit={e => { e.preventDefault(); change('addGuest', { name: guestName.trim() }, '已新增臨打，尚未匯入排點。'); }} style={{ marginTop: 20 }}>
                <label>手動新增臨打<input style={input} value={guestName} maxLength={40} required onChange={e => setGuestName(e.target.value)} placeholder="球友姓名" /></label>
                <button style={{ ...button, marginTop: 12 }} disabled={busy || !guestName.trim()}>新增至報名名單</button>
              </form>
            </article>
          </div>
        </>}
        {data.team && <article style={card}><h2 style={{ fontSize: 18, marginTop: 0 }}>球團設定</h2><p>{data.team.name} · 固定球友計費基準 ${data.team.fixedFee} / 次</p><p>{data.team.recurrence.frequency === 'weekly' ? `每 ${data.team.recurrence.intervalWeeks} 週一次，提前 ${data.team.recurrence.leadDays} 天開放下一場` : '單次成團；下一場由團長手動建立'}</p></article>}
        {data.archives.length > 0 && <article style={card}><h2 style={{ fontSize: 18, marginTop: 0 }}>歷史報名紀錄</h2>{data.archives.map(a => <details key={a.eventId}><summary>{a.eventTime}</summary><p>{a.location}</p><p>固定球友：{a.fixed.join('、') || '無'}</p><p>臨打：{a.guests.map(p => p.name).join('、') || '無'}</p></details>)}</article>}
        <article style={card}><h2 style={{ fontSize: 18, marginTop: 0 }}>請假統計</h2><p style={{ color: '#a5b2aa', fontSize: 13 }}>請假次數供團長參考，不代表退款或欠款。</p>
          {data.absenceStats.map(p => <p key={p.name}>{p.name}：{p.count} 次</p>)}
        </article>
      </>}
      {form && <div style={{ position: 'fixed', inset: 0, zIndex: 205, background: '#000b', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <form role="dialog" aria-modal="true" aria-label={form.mode === 'setupTeam' ? '建立球團' : form.mode === 'create' ? '建立報名活動' : '編輯報名活動'} onSubmit={e => { e.preventDefault(); if (form.mode === 'create' && exists && !confirm('將保存目前報名紀錄並開新活動。舊連結不會轉到新活動，排點也不會清空。確定建立？')) return; change(form.mode, { fields: { ...(form.mode === 'setupTeam' ? { name: form.name, guestFee: Number(form.guestFee), fixedFee: Number(form.fixedFee), fixedMembers: form.fixedNames.split(/[,，\n]/).map(s => s.trim()).filter(Boolean), frequency: form.frequency, intervalWeeks: Number(form.intervalWeeks), leadDays: Number(form.leadDays) } : {}), date: form.date, startTime: form.startTime, endTime: form.endTime, location: form.location, totalCapacity: Number(form.totalCapacity) } }, form.mode !== 'edit' ? '已建立，固定球友預設加入；可複製連結分享。' : '活動設定已更新，原名單保留。'); }} style={{ ...card, maxWidth: 520, width: '100%', maxHeight: '85dvh', overflowY: 'auto' }}>
          <h2 style={{ marginTop: 0 }}>{form.mode === 'setupTeam' ? '建立球團與首場活動' : form.mode === 'create' ? '建立報名活動' : '編輯本次活動'}</h2>
          <div style={{ display: 'grid', gap: 16 }}>
            {form.mode === 'setupTeam' && <>
              <label>球團名稱<input style={input} required maxLength={60} value={form.name} onChange={e => field('name', e.target.value)} /></label>
              <label>臨打每次費用（元）<input style={input} type="number" min={0} max={100000} step="0.01" required value={form.guestFee} onChange={e => field('guestFee', e.target.value)} /></label>
              <label>固定球友每次計費基準（元）<input style={input} type="number" min={0} max={100000} step="0.01" required value={form.fixedFee} onChange={e => field('fixedFee', e.target.value)} /><small>用於區分費率；預繳與請假退款另行處理。</small></label>
              <label>固定球友（每行一位，可留白）<textarea style={input} rows={4} value={form.fixedNames} onChange={e => field('fixedNames', e.target.value)} /></label>
              <label>開團方式<select style={input} value={form.frequency} onChange={e => field('frequency', e.target.value)}><option value="once">單次成團</option><option value="weekly">固定頻率自動開團</option></select></label>
              {form.frequency === 'weekly' && <>
                <label>每幾週一次<input style={input} type="number" min={1} max={12} required value={form.intervalWeeks} onChange={e => field('intervalWeeks', e.target.value)} /></label>
                <label>提前幾天開放下一場報名<input style={input} type="number" min={0} max={28} required value={form.leadDays} onChange={e => field('leadDays', e.target.value)} /></label>
                <p>以首場日期為基準，每隔指定週數開團。每天台灣時間上午 9 點時段檢查（免費方案可能稍晚執行）；上一場結束後、且到達提前開放日才開下一場。舊名單保存，不發 LINE 推播。</p>
              </>}
            </>}
            <label>活動日期<input type="date" required style={input} value={form.date} onInput={e => field('date', e.target.value)} onChange={e => field('date', e.target.value)} /></label>
            <label>開始時間<input type="time" required style={input} value={form.startTime} onInput={e => field('startTime', e.target.value)} onChange={e => field('startTime', e.target.value)} /></label>
            <label>結束時間<input type="time" required style={input} value={form.endTime} onInput={e => field('endTime', e.target.value)} onChange={e => field('endTime', e.target.value)} /></label>
            <label>場地<input required style={input} maxLength={120} value={form.location} onChange={e => field('location', e.target.value)} /></label>
            <label>總名額（含固定球友）<input type="number" min={Math.max(1, data.fixed.length)} max={200} required style={input} value={form.totalCapacity} onChange={e => field('totalCapacity', e.target.value)} /></label>
          </div>
          <p style={{ color: '#a5b2aa', fontSize: 13 }}>{form.mode === 'setupTeam' ? '建立後立即開放首場報名。' : '費用沿用球團設定。'}新活動開放報名，固定球友預設參加；不會主動發送群組訊息。</p>
          {error && <p role="alert" style={{ color: '#ffb5b5' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10 }}><button style={button} disabled={busy}>{busy ? '儲存中…' : form.mode !== 'edit' ? '建立並開放報名' : '儲存設定'}</button><button type="button" style={button} disabled={busy} onClick={() => setForm(null)}>返回</button></div>
        </form>
      </div>}
    </div>
  </section>;
}
