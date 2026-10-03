function ActivityHandoffPanel({ onClose, onApplied }) {
  const [draft, setDraft] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const [adds, setAdds] = React.useState([]);
  const [removes, setRemoves] = React.useState([]);
  const [links, setLinks] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const endpoint = (window.ROSTER_API_URL || 'https://badminton-signup-bot.vercel.app') + '/api/roster-handoff';

  async function request(method, body) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('請先登入團長帳號');
    const response = await fetch(endpoint, { method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + await user.getIdToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '讀取失敗');
    return result;
  }
  async function readRanking() {
    const token = await firebase.auth().currentUser.getIdToken();
    const response = await fetch(FIREBASE_URL + '.json?auth=' + encodeURIComponent(token), {
      cache: 'no-store', headers: { 'X-Firebase-ETag': 'true' },
    });
    if (!response.ok) throw new Error('無法讀取排點資料，請確認團長權限');
    const etag = response.headers.get('ETag');
    if (!etag) throw new Error('無法取得資料版本，暫停匯入以避免覆蓋');
    return { data: await response.json() || {}, etag, token };
  }
  async function load() {
    setBusy(true); setError(''); setPreview(null); setDraft(null);
    try { setDraft(await request('GET')); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  React.useEffect(function() { load(); }, []);
  async function confirmRoster() {
    setBusy(true); setError('');
    try {
      const packet = await request('POST', { fingerprint: draft.fingerprint });
      const snapshot = await readRanking();
      const changes = window.RosterHandoff.diff(packet, snapshot.data.players || [], snapshot.data.eventIntegration);
      setPreview({ packet, snapshot, changes });
      setAdds(changes.additions.map(p => p.registrationId)); setRemoves([]); setLinks([]);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setError('');
    try {
      const latest = await request('POST', { fingerprint: draft.fingerprint });
      if (latest.event.eventId !== preview.packet.event.eventId) throw new Error('目前已換成另一場活動，請重新預覽');
      const data = preview.snapshot.data;
      const onCourt = new Set();
      ((data.currentMatch || {}).courts || []).forEach(c => {
        if (c) (c.team1 || []).concat(c.team2 || []).forEach(id => onCourt.add(id));
      });
      const players = window.RosterHandoff.apply(preview.packet, data.players || [], data.eventIntegration, adds, removes, onCourt, links);
      const next = { ...data, players, eventIntegration: {
        ...preview.packet.event, revision: preview.packet.revision, confirmedRoster: preview.packet.roster,
        importedAt: Date.now(),
      } };
      const token = await firebase.auth().currentUser.getIdToken();
      const response = await fetch(FIREBASE_URL + '.json?auth=' + encodeURIComponent(token), {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': preview.snapshot.etag }, body: JSON.stringify(next),
      });
      if (response.status === 412) throw new Error('排點資料已被調整，尚未套用；請重新預覽差異');
      if (!response.ok) throw new Error('匯入未成功，請確認資料庫權限後重試');
      onApplied(players, next.eventIntegration); onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  function toggle(list, setList, id) { setList(list.includes(id) ? list.filter(v => v !== id) : list.concat(id)); }
  const button = { padding: '10px 14px', borderRadius: 8, border: '1px solid #506050', background: '#23362c', color: '#fff', cursor: 'pointer' };
  return <div style={{ position: 'fixed', inset: 0, zIndex: 210, background: '#000b', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <section role="dialog" aria-modal="true" aria-label="活動與名單交接" style={{ background: '#1a2029', color: '#fff', borderRadius: 16, padding: 24, width: 520, maxWidth: '95vw', maxHeight: '88vh', overflowY: 'auto', fontFamily: 'sans-serif' }}>
      <h2>活動與名單交接</h2>
      <p>確認本次報名名單後，再選擇套用到排點。人工調整及既有場上安排會保留。</p>
      {error && <p role="alert" style={{ color: '#ffadad' }}>{error}</p>}
      {busy && <p>處理中…</p>}
      {draft && <><h3>{draft.event.eventTime}</h3><p>報名名單 {draft.roster.length} 人</p></>}
      {draft && !preview && <>
        <ul>{draft.roster.map(p => <li key={p.registrationId}>{p.name} · {p.participantType === 'fixed' ? '固定球友' : '臨打'}</li>)}</ul>
        <p>首次確認會建立本次活動紀錄。此步驟尚不修改排點。</p>
        <button style={button} disabled={busy} onClick={confirmRoster}>確認名單並預覽匯入差異</button>
      </>}
      {preview && <>
        <h3>選擇要套用的變更</h3>
        {preview.changes.additions.map(p => <p key={p.registrationId}><label><input type="checkbox" disabled={busy} checked={adds.includes(p.registrationId)} onChange={() => toggle(adds, setAdds, p.registrationId)} /> 新增：{p.name}</label></p>)}
        {preview.changes.removals.map(p => <p key={p.id}><label><input type="checkbox" disabled={busy} checked={removes.includes(p.id)} onChange={() => toggle(removes, setRemoves, p.id)} /> 移除：{p.name}（未勾選就保留）</label></p>)}
        {preview.changes.conflicts.map(c => <p key={c.person.registrationId}><label><input type="checkbox" disabled={busy} checked={links.includes(c.person.registrationId)} onChange={() => toggle(links, setLinks, c.person.registrationId)} /> {c.person.name} 已在排點：確認為同一人並建立對應（保留等級、報到等人工設定）</label></p>)}
        {preview.changes.manual.length > 0 && <p>排點自行加入的人員會保留：{preview.changes.manual.map(p => p.name).join('、')}</p>}
        {!preview.changes.additions.length && !preview.changes.removals.length && !preview.changes.conflicts.length && <p>名單一致，沒有需新增或移除的人員。</p>}
        <p>新增人員尚未報到、不會自動上場；移除上場中球員會被阻擋。</p>
        <button style={button} disabled={busy} onClick={apply}>套用選取的變更</button>
      </>}
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button style={button} disabled={busy} onClick={load}>重新預覽最新名單</button>
        <button style={button} disabled={busy} onClick={onClose}>關閉</button>
      </div>
    </section>
  </div>;
}
