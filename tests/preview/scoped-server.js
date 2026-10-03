// Isolated multi-account preview; fake identities, memory database, no cloud connections.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
let store = {};
const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const db = { ref(location) {
  const parts = location.split('/').filter(Boolean);
  const read = () => parts.reduce((value, part) => value?.[part], store) ?? null;
  function write(value) { let target = store; parts.slice(0, -1).forEach(part => { target[part] ||= {}; target = target[part]; }); target[parts.at(-1)] = clone(value); }
  return { once: async () => ({ val: () => clone(read()) }), set: async value => write(value), transaction: async callback => {
    const value = callback(clone(read()));
    if (value !== undefined) write(value);
    return { committed: value !== undefined, snapshot: { val: () => clone(read()) } };
  } };
} };
const users = {
  admin: { uid: 'demo-admin', email: 'admin@example.test', email_verified: true },
  leader: { uid: 'demo-leader', email: 'leader@example.test', email_verified: true },
  second: { uid: 'demo-second', email: 'second@example.test', email_verified: true },
};
const origin = 'http://127.0.0.1:' + (process.env.PREVIEW_PORT || '8767');
const env = { RANKING_ORIGIN: origin, RANKING_AUTH_PROJECT_ID: 'badminton-scheduler-8a849', PLATFORM_ADMIN_EMAILS: 'admin@example.test', ROSTER_MANAGER_UIDS: 'demo-leader', FIREBASE_DATABASE_URL: 'https://badminton-scheduler-8a849-default-rtdb.asia-southeast1.firebasedatabase.app', LINE_GROUP_ID: 'demo-group' };
const admin = { apps: [], auth: () => ({ getUser: async uid => Object.values(users).find(user => user.uid === uid) }), initializeApp(options, name) {
  const app = { name, auth: () => ({ verifyIdToken: async token => { if (!users[token]) throw new Error('Invalid token'); return users[token]; } }) }; this.apps.push(app); return app;
} };
const cache = {};
function load(file) {
  file = path.resolve(file); if (!path.extname(file)) file += '.js';
  if (cache[file]) return cache[file];
  if (file === path.join(root, '報名機器人/api/_lib.js')) return { db, fixedOf: require('../../報名機器人/lib/registration').fixedOf, LINE_GROUP_ID: 'demo-group' };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, process: { env }, Date, require(name) { if (name === 'firebase-admin') return admin; return name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : require(name); } }, { filename: file });
  cache[file] = module.exports; return module.exports;
}
const routes = Object.fromEntries(['registration-admin', 'roster-handoff', 'status', 'signup', 'cancel', 'ranking-view'].map(name => ['/api/' + name, load(path.join(root, '報名機器人/api/' + name + '.js'))]));
http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:");
  if (routes[url.pathname]) {
    let raw = ''; for await (const chunk of req) raw += chunk;
    req.query = Object.fromEntries(url.searchParams); req.body = raw ? JSON.parse(raw) : undefined;
    res.status = code => { res.statusCode = code; return res; }; res.json = value => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); return res; };
    try { await routes[url.pathname](req, res); } catch (_) { res.status(500).json({ message: '測試伺服器錯誤' }); }
    return;
  }
  if (url.pathname === '/' && url.searchParams.has('event')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(root, '報名機器人/index.html'))); return; }
  if (url.pathname === '/') {
    let html = fs.readFileSync(path.join(root, 'ranking/index.html'), 'utf8').replace(/  <!-- Firebase Authentication[\s\S]*?(?=  <!-- 全域設定 -->)/, '  <script src="scoped-mock.js"></script>\n');
    html = html.replace('<div id="root"></div>', '<div style="position:fixed;top:0;z-index:180;padding:10px;background:#284b36;color:white;width:100%;height:76px"><strong>本機虛構帳號測試｜不連正式資料</strong><br><button onclick="location.search=\'?registration&as=admin\'">以 Admin 身分預覽</button> <button onclick="location.search=\'?registration&as=leader\'">以團長甲身分預覽</button> <button onclick="location.search=\'?registration&as=second\'">以團長乙身分預覽</button></div><style>#root > div{top:76px!important}</style><div id="root"></div>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
  }
  const relative = url.pathname === '/scoped-mock.js' ? 'tests/preview/scoped-mock.js' : 'ranking/' + url.pathname.slice(1);
  if (!/\.(js|jsx)$/.test(relative) || !/^[a-zA-Z0-9_./-]+$/.test(relative) || relative.includes('..') || !fs.existsSync(path.join(root, relative))) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(root, relative)));
}).listen(Number(process.env.PREVIEW_PORT || 8767), '127.0.0.1', () => console.log('Admin 與獨立球團測試頁：' + origin + '/?registration&as=admin'));
