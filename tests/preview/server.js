// Local-only preview. No credentials and no server-side connection to real services.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const files = {
  '/mock.js': path.join(__dirname, 'mock.js'),
  '/handoff.js': path.join(root, 'ranking/handoff.js'),
  '/handoff-panel.jsx': path.join(root, 'ranking/handoff-panel.jsx'),
  '/main.js': path.join(root, 'ranking/main.js'),
};
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:");
  if (url.pathname === '/') {
    let html = fs.readFileSync(path.join(root, 'ranking/index.html'), 'utf8');
    // Remove the actual Firebase SDK and configuration, including auth persistence.
    html = html.replace(/  <!-- Firebase Authentication[\s\S]*?(?=  <!-- 全域設定 -->)/, '  <script src="mock.js"></script>\n');
    html = html.replace('<div id="root"></div>', `<div id="demo-bar" style="position:fixed;inset:0 0 auto;height:76px;z-index:180;background:#284b36;padding:8px 12px;color:white;font:13px sans-serif;overflow:auto">
      <strong>本機測試｜全為虛構資料，不連正式名單</strong>
      <button id="demo-change">模擬乙取消、丁報名</button>
      <button id="demo-conflict">模擬下一次匯入衝突</button>
      <button onclick="location.reload()">重新開始</button>
      <div id="demo-status">先按右側「活動匯入」，完成第一次匯入。</div>
    </div><style>#root > div { top:76px !important; }</style><div id="root"></div>`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
  }
  if (files[url.pathname]) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(fs.readFileSync(files[url.pathname])); return;
  }
  res.writeHead(404); res.end('Not found');
}).listen(8765, '127.0.0.1', () => console.log('本機虛構資料測試頁：http://127.0.0.1:8765/'));
