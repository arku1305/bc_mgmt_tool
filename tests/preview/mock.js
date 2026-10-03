(function() {
  'use strict';
  const nativeFetch = window.fetch.bind(window);
  let version = 0, revision = 1, rejectWrite = false;
  const event = { teamId: 'demo-team', eventId: 'demo-event', eventTime: '10/6(二) 20-22' };
  let roster = [
    { registrationId: 'fixed-a', name: '固定甲', participantType: 'fixed' },
    { registrationId: 'guest-b', name: '臨打乙', participantType: 'guest' },
  ];
  let data = { players: [{ id: 'manual-c', name: '手動丙', level: 8, regular: false, checkedIn: false, paid: false }], currentMatch: { courts: [{ team1: [], team2: [] }, { team1: [], team2: [] }] }, roundNumbers: [1, 1] };
  const user = { getIdToken: async () => 'demo-token-not-a-real-credential' };
  window.firebase = { auth: () => ({ currentUser: user, onAuthStateChanged(callback) { queueMicrotask(() => callback(user)); return () => {}; }, async signOut() { alert('測試頁不需要登入；重新整理即可從頭測試。'); } }) };
  window.ROSTER_API_URL = window.location.origin;
  window.__TWEAKS__ = { theme: 'minimal', accent: '#8ff3b5' };
  const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  window.fetch = async function(input, options = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    if (url.origin === window.location.origin && url.pathname === '/api/roster-handoff') {
      const fingerprint = 'demo-revision-' + revision;
      if (options.method === 'POST') {
        if (JSON.parse(options.body).fingerprint !== fingerprint) return json({ message: '報名名單已更新，請重新預覽並確認' }, 409);
        return json({ schemaVersion: 1, event, roster, revision: fingerprint, confirmedAt: Date.now() });
      }
      return json({ event, roster, fingerprint });
    }
    // Production URL is intercepted, never requested. CSP also blocks external connections.
    if (url.hostname === 'badmintion-ranking-default-rtdb.asia-southeast1.firebasedatabase.app' && url.pathname.startsWith('/badminton')) {
      const parts = url.pathname.replace(/^\/badminton/, '').replace(/\.json$/, '').split('/').filter(Boolean);
      if (options.method === 'PUT') {
        if (options.headers?.['If-Match']) {
          if (rejectWrite) { rejectWrite = false; version++; return json({ message: '模擬版本變動' }, 412); }
          if (options.headers['If-Match'] !== '"demo-' + version + '"') return json({}, 412);
        }
        const value = JSON.parse(options.body);
        if (!parts.length) data = value;
        else {
          let target = data;
          parts.slice(0, -1).forEach(part => { target[part] = target[part] || {}; target = target[part]; });
          target[parts.at(-1)] = value;
        }
        version++;
        return json(value);
      }
      let value = data;
      parts.forEach(part => { value = value?.[part]; });
      return json(value ?? null, 200, { ETag: '"demo-' + version + '"' });
    }
    if (url.origin === window.location.origin) return nativeFetch(input, options);
    throw new Error('測試頁已阻擋外部資料連線');
  };
  document.getElementById('demo-change').onclick = function() {
    roster = [roster[0], { registrationId: 'guest-d', name: '臨打丁', participantType: 'guest' }];
    revision++;
    document.getElementById('demo-status').textContent = '已模擬：乙取消、丁報名。按「活動匯入」查看差異；更新提示最多等 30 秒。';
  };
  document.getElementById('demo-conflict').onclick = function() {
    rejectWrite = true;
    document.getElementById('demo-status').textContent = '下一次套用會模擬資料衝突，應提示重新預覽。';
  };
})();
