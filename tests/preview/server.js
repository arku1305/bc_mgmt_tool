// Local-only preview. No credentials and no server-side connection to real services.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const { draftRoster } = require('../../報名機器人/api/_handoff');
const { mutate, adminView, digest, publicActivity, remainingOf, entriesOf, slotsOf } = require('../../報名機器人/lib/registration');
const { publicCommand } = require('../../報名機器人/lib/public-command');
let registration = {};
const files = {
  '/mock.js': path.join(__dirname, 'mock.js'),
  '/handoff.js': path.join(root, 'ranking/handoff.js'),
  '/handoff-panel.jsx': path.join(root, 'ranking/handoff-panel.jsx'),
  '/registration-panel.jsx': path.join(root, 'ranking/registration-panel.jsx'),
  '/main.js': path.join(root, 'ranking/main.js'),
};
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:");
  if (url.pathname === '/api/demo-reset' && req.method === 'POST') { registration = {}; res.end('{}'); return; }
  if (url.pathname === '/api/status') {
    const session = registration.current || {};
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(url.searchParams.get('event') && url.searchParams.get('event') !== session.activityId ? { eventId: null, stale: true, registrationOpen: false, eventTime: '活動已換場', remaining: 0 } : { ...publicActivity(session), remaining: Math.max(0, remainingOf(session)), taken: entriesOf(session).length, maxSlots: slotsOf(session) })); return;
  }
  if (url.pathname === '/api/signup' || url.pathname === '/api/cancel') {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      try { registration.current = publicCommand(registration.current, url.pathname.split('/').pop(), JSON.parse(body), Date.now()); res.end(JSON.stringify({ success: true })); }
      catch (error) { res.statusCode = 409; res.end(JSON.stringify({ success: false, message: error.message })); }
    }); return;
  }
  if (url.pathname === '/' && url.searchParams.has('event')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(root, '報名機器人/index.html'))); return; }
  if (url.pathname === '/api/roster-handoff') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const draft = draftRoster(registration.current || {}, registration.team?.fixedMembers || [], 'demo-team');
      if (req.method === 'GET') { res.end(JSON.stringify(draft)); return; }
      let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
        if (JSON.parse(body).fingerprint !== draft.fingerprint) { res.statusCode = 409; res.end(JSON.stringify({ message: '名單已更新' })); return; }
        res.end(JSON.stringify({ schemaVersion: 1, event: draft.event, roster: draft.roster, revision: draft.fingerprint, confirmedAt: Date.now() }));
      });
    } catch (error) { res.statusCode = 409; res.end(JSON.stringify({ message: error.message })); }
    return;
  }
  if (url.pathname === '/api/registration-admin') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'GET') { res.end(JSON.stringify(adminView(registration))); return; }
    let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
      try {
        const command = JSON.parse(body);
        if (command.expectedRevision !== digest(registration)) { res.statusCode = 409; res.end(JSON.stringify({ message: '資料已更新，請重新整理' })); return; }
        registration = mutate(registration, command, { now: Date.now(), uid: 'demo', eventId: 'demo-' + Date.now() });
        res.end(JSON.stringify(adminView(registration)));
      } catch (error) { res.statusCode = 422; res.end(JSON.stringify({ message: error.message })); }
    }); return;
  }
  if (url.pathname === '/') {
    let html = fs.readFileSync(path.join(root, 'ranking/index.html'), 'utf8');
    // Remove the actual Firebase SDK and configuration, including auth persistence.
    html = html.replace(/  <!-- Firebase Authentication[\s\S]*?(?=  <!-- 全域設定 -->)/, '  <script src="mock.js"></script>\n');
    html = html.replace('<div id="root"></div>', `<div id="demo-bar" style="position:fixed;inset:0 0 auto;height:76px;z-index:180;background:#284b36;padding:8px 12px;color:white;font:13px sans-serif;overflow:auto">
      <strong>本機測試｜全為虛構資料，不連正式名單</strong>
      <button id="demo-change">模擬乙取消、丁報名</button>
      <button id="demo-conflict">模擬下一次匯入衝突</button>
      <button id="demo-restart">重新開始</button>
      <div id="demo-status">先按右側「活動匯入」，完成第一次匯入。</div>
    </div><style>#root > div { top:76px !important; }</style><div id="root"></div>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
  }
  if (files[url.pathname]) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(fs.readFileSync(files[url.pathname])); return;
  }
  res.writeHead(404); res.end('Not found');
}).listen(Number(process.env.PREVIEW_PORT || 8765), '127.0.0.1', () => console.log('本機虛構資料測試頁已啟動'));
