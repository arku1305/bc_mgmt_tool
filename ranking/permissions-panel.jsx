function PermissionsAdmin() {
  const [people, setPeople] = React.useState([]);
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [removing, setRemoving] = React.useState(null);
  const [notice, setNotice] = React.useState('');
  const endpoint = (window.ROSTER_API_URL || 'https://badminton-signup-bot.vercel.app') + '/api/registration-admin?scope=permissions';
  async function request(method, body) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('請先登入 Admin 帳號');
    const res = await fetch(endpoint, { method, cache: 'no-store', headers: { Authorization: 'Bearer ' + await user.getIdToken(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await res.json();
    if (!res.ok) throw new Error(result.message || '權限管理暫時無法使用');
    return result;
  }
  async function load() {
    setBusy(true); setError('');
    try { setPeople((await request('GET')).organizers); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  React.useEffect(() => { load(); }, []);
  async function add(e) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { const result = await request('POST', { email: email.trim() }); setPeople(result.organizers); setEmail(''); setNotice('團長已新增，請使用該 Email 的 Google 帳號登入。'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function change(body) {
    setBusy(true); setError(''); setNotice('');
    try { setPeople((await request('POST', body)).organizers); setRemoving(null); setNotice(body.action === 'remove' ? '已移除團長權限，球團資料仍保留。' : '權限已更新。'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const input = { padding: 12, border: '1px solid #42534a', borderRadius: 8, background: '#10161d', color: '#edf4f0', fontSize: 16 };
  const button = { ...input, background: '#22362c', color: '#b9f4d1', cursor: 'pointer' };
  return <section aria-label="平台權限管理" style={{ flex: 1, overflowY: 'auto', padding: 24, color: '#edf4f0' }}><div style={{ maxWidth: 960, margin: '0 auto' }}>
    <h1>權限管理</h1><p>只有平台 Admin 能查看此頁、新增團長及調整權限。此頁不顯示任何人的球團資料。</p>
    {error && <p role="alert" style={{ color: '#ffb5b5' }}>{error}</p>}{notice && <p role="status" style={{ color: '#b9f4d1' }}>{notice}</p>}
    <form onSubmit={add} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '24px 0', alignItems: 'end' }}>
      <label style={{ display: 'grid', gap: 8, flex: 1 }}>新增團長 Email<input style={input} type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="請填寫團長的 Google 帳號" /></label>
      <button style={button} disabled={busy}>新增團長</button><button style={button} type="button" disabled={busy} onClick={load}>重新整理</button>
    </form>
    <h2>目前團長名單（{people.length} 位）</h2>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}><thead><tr>{['Email', '報名管理', '排點管理', '操作'].map(s => <th key={s} style={{ padding: 12 }}>{s}</th>)}</tr></thead><tbody>{people.map(p => <tr key={p.email}><td style={{ padding: 12 }}>{p.email}</td>{['registration', 'ranking'].map(module => <td key={module} style={{ padding: 12 }}><select aria-label={p.email + (module === 'registration' ? ' 報名管理' : ' 排點管理')} style={input} disabled={busy} value={p.modules?.[module] !== false && p.enabled ? 'on' : 'off'} onChange={e => change({ action: 'setModule', email: p.email, module, enabled: e.target.value === 'on' })}><option value="on">可使用</option><option value="off">停止使用</option></select></td>)}<td><button style={button} disabled={busy} onClick={() => setRemoving(p.email)}>刪除團長</button></td></tr>)}</tbody></table></div>
    {removing && <div role="alertdialog" aria-label="確認刪除團長" style={{ padding: 20, border: '1px solid #b97979', marginTop: 20 }}><p>確定移除 {removing} 的團長權限？他將無法管理報名與排點，球團資料會保留。日後重新新增同一 Email 可恢復管理。</p><button style={button} disabled={busy} onClick={() => change({ action: 'remove', email: removing })}>確認移除權限</button> <button style={button} disabled={busy} onClick={() => setRemoving(null)}>取消</button></div>}
    <p style={{ marginTop: 24, color: '#a5b2aa' }}>每位團長與 Admin 都只能管理自己的球團。Admin 可使用所有已完成的功能，也可開團。帳務模組尚未完成。</p>
  </div></section>;
}
